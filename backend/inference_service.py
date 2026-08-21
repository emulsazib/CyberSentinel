#!/usr/bin/env python3
"""
CyberSentinel Inference Service
===============================
Direct neural inference service for the GRPO-trained CTI agent.
Communicates via JSON-RPC over stdin/stdout.

Two engines, tried in order:

  1. llama.cpp GGUF  — a quantised single-file model (Q4_K_M, ~2.5GB for a 4B
     policy). Preferred for local serving: it is the only option that fits an
     8GB machine, and llama.cpp has fast quantised CPU kernels plus Metal
     offload on Apple Silicon. Enable by pointing CTI_GGUF_PATH at the file, or
     by dropping a .gguf into models/.
  2. transformers + PEFT — base model (Qwen3-4B-Instruct-2507) plus LoRA
     adapters from grpo_cti_tokenizer_model / grpo_cti_lora_adapters, on
     CUDA -> MPS -> CPU. Needs the full fp16/fp32 weights in RAM.
"""

from __future__ import annotations

import glob
import json
import os
import platform
import re
import sys
from typing import Any, Dict, Optional

# Paths
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_BASE_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
DEFAULT_ADAPTER_PATH = os.path.join(ROOT_DIR, "grpo_cti_tokenizer_model")
FALLBACK_ADAPTER_PATH = os.path.join(ROOT_DIR, "grpo_cti_lora_adapters")

# GGUF: explicit path wins, else the first *.gguf found in models/
DEFAULT_GGUF_DIR = os.path.join(ROOT_DIR, "models")
GGUF_PATH_ENV = os.environ.get("CTI_GGUF_PATH", "").strip()
# -1 offloads every layer to the GPU (Metal on Apple Silicon); 0 forces pure CPU.
GGUF_GPU_LAYERS = int(os.environ.get("CTI_GPU_LAYERS", "-1"))
# Training capped prompts at 640 tokens, but the console invites pasting whole EDR
# logs and llama.cpp errors rather than truncating when a prompt exceeds n_ctx.
# 4096 is cheap KV cache at this model size and keeps a long paste answerable.
GGUF_N_CTX = int(os.environ.get("CTI_N_CTX", "4096"))
# Generation threads. 0/unset lets llama.cpp choose. On heterogeneous CPUs
# (Apple's performance + efficiency cores) matching the performance-core count
# often beats using every core, since the slow cores gate each step.
GGUF_THREADS = int(os.environ.get("CTI_THREADS", "0"))

# Exact system prompt used during GRPO policy training
SYSTEM_PROMPT = (
    "You are a cyber threat intelligence analyst. You are given a threat "
    "intelligence text snippet describing adversary behavior. Identify the "
    "single most relevant MITRE ATT&CK technique.\n"
    "Think step-by-step inside <reasoning> tags and output the exact MITRE "
    "ATT&CK ID (e.g. T1059 or T1059.001) inside <answer> tags.\n"
    "Respond in EXACTLY this format and nothing else:\n"
    "<reasoning>\n...your step-by-step analysis...\n</reasoning>\n"
    "<answer>T####</answer>"
)

_REASONING = re.compile(r"<reasoning>\s*(.*?)\s*</reasoning>", re.DOTALL | re.IGNORECASE)
_ANSWER = re.compile(r"<answer>\s*(.*?)\s*</answer>", re.DOTALL | re.IGNORECASE)
_TID = re.compile(r"T\d{4}(?:\.\d{3})?", re.IGNORECASE)

# Global model state
g_model = None
g_tokenizer = None
g_device_name = "cpu"
g_model_loaded = False
g_load_error = None
g_engine = None          # "gguf" | "transformers"
g_model_source = None    # gguf file path, or the base-model id


def resolve_gguf_path() -> Optional[str]:
    """Return the GGUF to load, or None.

    CTI_GGUF_PATH wins; otherwise search models/ recursively, because the training
    export writes into a subdirectory (models/grpo_cti_gguf/*.gguf) and requiring a
    manual flatten is a silent-failure trap — a missed file falls through to the
    transformers engine and starts an 8GB download instead.
    """
    if GGUF_PATH_ENV:
        candidate = GGUF_PATH_ENV
        if not os.path.isabs(candidate):
            candidate = os.path.join(ROOT_DIR, candidate)
        if os.path.isfile(candidate):
            return candidate
        sys.stderr.write(
            f"[CyberSentinel] CTI_GGUF_PATH={GGUF_PATH_ENV!r} does not exist; ignoring.\n"
        )
        sys.stderr.flush()
        return None

    matches = sorted(glob.glob(os.path.join(DEFAULT_GGUF_DIR, "**", "*.gguf"), recursive=True))
    if not matches:
        return None
    if len(matches) > 1:
        # Never leave the choice implicit when several policies are present.
        sys.stderr.write(
            f"[CyberSentinel] {len(matches)} GGUF files under {DEFAULT_GGUF_DIR}; "
            f"using {os.path.basename(matches[0])}. Set CTI_GGUF_PATH to pick another.\n"
        )
        sys.stderr.flush()
    return matches[0]


def extract_reasoning(text: str) -> Optional[str]:
    match = _REASONING.search(text)
    return match.group(1).strip() if match else None


def extract_answer(text: str) -> Optional[str]:
    match = _ANSWER.search(text)
    if not match:
        return None
    tid = _TID.search(match.group(1))
    return tid.group(0).upper() if tid else match.group(1).strip().upper() or None


def try_load_gguf(gguf_path: str) -> bool:
    """Load a quantised GGUF through llama.cpp. Returns True on success."""
    global g_model, g_tokenizer, g_device_name, g_model_loaded, g_load_error
    global g_engine, g_model_source

    try:
        from llama_cpp import Llama

        size_gb = os.path.getsize(gguf_path) / 1e9
        sys.stderr.write(
            f"[CyberSentinel] Loading GGUF policy '{os.path.basename(gguf_path)}' "
            f"({size_gb:.2f} GB, n_gpu_layers={GGUF_GPU_LAYERS}, n_ctx={GGUF_N_CTX})...\n"
        )
        sys.stderr.flush()

        kwargs = dict(
            model_path=gguf_path,
            n_ctx=GGUF_N_CTX,
            n_gpu_layers=GGUF_GPU_LAYERS,
            verbose=False,
        )
        if GGUF_THREADS > 0:
            kwargs["n_threads"] = GGUF_THREADS
        model = Llama(**kwargs)

        # Metal is the only GPU backend reachable here (llama-cpp-python built with
        # -DGGML_METAL=on). Everything else runs on optimised quantised CPU kernels.
        on_apple_gpu = GGUF_GPU_LAYERS != 0 and platform.system() == "Darwin"
        g_device_name = "metal" if on_apple_gpu else "cpu"

        g_model = model
        g_tokenizer = None          # llama.cpp owns tokenization and the chat template
        g_engine = "gguf"
        g_model_source = gguf_path
        g_model_loaded = True
        g_load_error = None
        sys.stderr.write(
            f"[CyberSentinel] GGUF CTI policy successfully loaded on {g_device_name}!\n"
        )
        sys.stderr.flush()
        return True
    except Exception as exc:  # noqa: BLE001
        g_load_error = str(exc)
        sys.stderr.write(f"[CyberSentinel] Warning: GGUF load exception ({exc}).\n")
        sys.stderr.flush()
        return False


def try_load_model(base_model: str = DEFAULT_BASE_MODEL, adapter_path: str = DEFAULT_ADAPTER_PATH):
    global g_model, g_tokenizer, g_device_name, g_model_loaded, g_load_error
    global g_engine, g_model_source

    # Prefer GGUF when one is available — it is the only engine that fits a
    # small-RAM host, and llama.cpp is far faster than PyTorch on CPU.
    gguf_path = resolve_gguf_path()
    if gguf_path and try_load_gguf(gguf_path):
        return True

    target_adapter = adapter_path
    if not os.path.exists(target_adapter) and os.path.exists(FALLBACK_ADAPTER_PATH):
        target_adapter = FALLBACK_ADAPTER_PATH

    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if torch.cuda.is_available():
            g_device_name = "cuda"
            device_map = "auto"
            model_dtype = torch.float16
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            g_device_name = "mps"
            device_map = None
            model_dtype = torch.float16
        else:
            g_device_name = "cpu"
            device_map = None
            model_dtype = torch.float32

        # CTI_DTYPE overrides the device default (e.g. bfloat16 to halve CPU RAM use)
        dtype_override = os.environ.get("CTI_DTYPE", "auto").strip().lower()
        if dtype_override and dtype_override != "auto":
            candidate = getattr(torch, dtype_override, None)
            if isinstance(candidate, torch.dtype):
                model_dtype = candidate
            else:
                sys.stderr.write(f"[CyberSentinel] Unknown CTI_DTYPE '{dtype_override}', keeping {model_dtype}.\n")

        sys.stderr.write(f"[CyberSentinel] Loading base neural model '{base_model}' on {g_device_name} (dtype: {model_dtype})...\n")
        sys.stderr.flush()

        # Load base model on CPU first
        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            dtype=model_dtype,
            device_map=None,
            trust_remote_code=True,
        )

        # Attach LoRA adapters before transferring to GPU
        if os.path.exists(target_adapter):
            sys.stderr.write(f"[CyberSentinel] Attaching fine-tuned LoRA adapters from {target_adapter}...\n")
            sys.stderr.flush()
            model = PeftModel.from_pretrained(model, target_adapter)
        
        # Transfer model + adapters together to target device
        sys.stderr.write(f"[CyberSentinel] Transferring model to {g_device_name}...\n")
        sys.stderr.flush()
        model.to(g_device_name)
        model.eval()

        # Tokenizer
        tokenizer_src = target_adapter if os.path.exists(target_adapter) else base_model
        sys.stderr.write(f"[CyberSentinel] Loading tokenizer from {tokenizer_src}...\n")
        sys.stderr.flush()
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_src, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token


        g_model = model
        g_tokenizer = tokenizer
        g_engine = "transformers"
        g_model_source = base_model
        g_model_loaded = True
        g_load_error = None
        sys.stderr.write(f"[CyberSentinel] Neural CTI model & LoRA weights successfully loaded into memory on {g_device_name}!\n")
        sys.stderr.flush()
        return True
    except Exception as exc:
        g_load_error = str(exc)
        g_model_loaded = False
        sys.stderr.write(f"[CyberSentinel] Warning: Neural load exception ({exc}).\n")
        sys.stderr.flush()
        return False


def build_messages(instruction: str, system_prompt: str, is_chat: bool):
    """The prompt contract the policy was rewarded against — identical for both engines."""
    user = instruction if is_chat else f"CTI snippet:\n{instruction}"
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user},
    ]


def parse_generation(raw_response: str) -> Dict[str, Any]:
    """Shared post-processing: pull <reasoning>/<answer> out of raw model text."""
    reasoning = extract_reasoning(raw_response)
    answer = extract_answer(raw_response)
    word_count = len(reasoning.split()) if reasoning else len(raw_response.split())
    return {
        "raw_response": raw_response,
        "reasoning": reasoning or raw_response,
        "answer": answer,
        "word_count": word_count,
    }


def generate_gguf(
    instruction: str,
    system_prompt: str,
    temperature: float,
    max_new_tokens: int,
    is_chat: bool,
) -> Dict[str, Any]:
    """Generate through llama.cpp. The GGUF carries its own chat template."""
    messages = build_messages(instruction, system_prompt, is_chat)

    result = g_model.create_chat_completion(
        messages=messages,
        temperature=temperature,
        top_p=0.9,
        max_tokens=max_new_tokens,
    )
    raw_response = (result["choices"][0]["message"]["content"] or "").strip()

    quant = os.path.basename(g_model_source or "gguf")
    return {
        "status": "ok",
        "engine": f"Fine-Tuned Neural Policy (llama.cpp {quant} on {g_device_name})",
        "device": g_device_name,
        "model_loaded": True,
        **parse_generation(raw_response),
    }


def generate_cti_response(
    instruction: str,
    system_prompt: str = SYSTEM_PROMPT,
    temperature: float = 0.1,
    max_new_tokens: int = 256,
    is_chat: bool = False,
) -> Dict[str, Any]:
    global g_model, g_tokenizer, g_model_loaded, g_device_name

    # If neural model is not yet loaded, try loading it now
    if not g_model_loaded or g_model is None:
        try_load_model()

    if g_model_loaded and g_model is not None and g_engine == "gguf":
        try:
            return generate_gguf(
                instruction, system_prompt, temperature, max_new_tokens, is_chat
            )
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[CyberSentinel] GGUF generation exception: {exc}\n")
            sys.stderr.flush()

    if g_model_loaded and g_model is not None and g_tokenizer is not None:
        try:
            import torch

            messages = build_messages(instruction, system_prompt, is_chat)

            prompt_text = g_tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
            inputs = g_tokenizer(prompt_text, return_tensors="pt")
            
            # Send inputs to model device
            target_device = g_device_name if g_device_name in ["mps", "cuda"] else "cpu"
            inputs = {k: v.to(target_device) for k, v in inputs.items()}

            do_sample = temperature > 0.01
            with torch.inference_mode():
                outputs = g_model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=do_sample,
                    temperature=max(temperature, 0.01) if do_sample else None,
                    top_p=0.9 if do_sample else None,
                    pad_token_id=g_tokenizer.pad_token_id,
                    eos_token_id=g_tokenizer.eos_token_id,
                )

            prompt_len = inputs["input_ids"].shape[-1]
            generated_ids = outputs[0][prompt_len:]
            raw_response = g_tokenizer.decode(generated_ids, skip_special_tokens=True).strip()

            short_name = (g_model_source or DEFAULT_BASE_MODEL).split("/")[-1]
            return {
                "status": "ok",
                "engine": f"Fine-Tuned Neural Policy ({short_name} LoRA on {g_device_name})",
                "device": g_device_name,
                "model_loaded": True,
                **parse_generation(raw_response),
            }
        except Exception as exc:
            sys.stderr.write(f"[CyberSentinel] Neural generation exception: {exc}\n")
            sys.stderr.flush()

    # Fallback error reporting if model fails to generate
    return {
        "status": "error",
        "engine": "Failed to run neural forward pass",
        "device": g_device_name,
        "message": f"Model inference error: {g_load_error}",
        "model_loaded": False,
    }


NO_MODEL_BANNER = """
================================================================================
  NO MODEL AVAILABLE — the API will return errors until one is supplied.

  This project does not ship or download weights. Supply a quantised GGUF:

  Docker:
      MODELS_DIR=/path/to/folder/with/your/gguf docker compose up -d
    or set CTI_GGUF_PATH to a file inside the container.

  Local (npm run dev):
      mkdir -p models && cp /path/to/your.gguf models/
    or: export CTI_GGUF_PATH=/absolute/path/to/your.gguf

  Searched: {searched}
{torch_note}================================================================================
"""


LOAD_FAILED_BANNER = """
================================================================================
  MODEL FOUND BUT FAILED TO LOAD — the API will return errors.

  File  : {path}
  Error : {error}

  The file was located, so this is a runtime problem rather than a missing
  model. A missing shared library (e.g. libgomp.so.1, which llama.cpp needs for
  OpenMP) means the image or environment lacks a dependency; a truncated or
  corrupt download means the GGUF itself is bad — re-download and compare sizes.
================================================================================
"""


def describe_missing_model() -> str:
    """Explain precisely why no engine came up, so a first run is diagnosable."""
    import importlib.util

    # Distinguish "no file anywhere" from "found it, but loading blew up" —
    # they have completely different fixes.
    found = resolve_gguf_path()
    if found and g_load_error:
        return LOAD_FAILED_BANNER.format(path=found, error=g_load_error)

    searched = GGUF_PATH_ENV or f"{DEFAULT_GGUF_DIR}/**/*.gguf  (recursive)"

    if importlib.util.find_spec("torch") is None:
        torch_note = (
            "\n  (The transformers fallback is unavailable: torch is not installed.\n"
            "   That is expected — this image ships the GGUF engine only. Rebuild\n"
            "   with --build-arg INSTALL_TORCH=true if you need the unquantised path.)\n"
        )
    else:
        torch_note = (
            "\n  (The transformers fallback is installed but needs to download an\n"
            "   ~8GB base model and cannot run usably on CPU. Prefer a GGUF.)\n"
        )
    return NO_MODEL_BANNER.format(searched=searched, torch_note=torch_note)


def main():
    sys.stderr.write("[CyberSentinel] Python Inference Service starting...\n")
    sys.stderr.flush()

    # Load model on startup
    try_load_model()

    if not g_model_loaded:
        sys.stderr.write(describe_missing_model())
        sys.stderr.flush()

    # JSON-RPC loop over stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            action = req.get("action", "generate")

            if action == "status":
                res = {
                    "status": "ok",
                    "model_loaded": g_model_loaded,
                    "device": g_device_name,
                    "engine": g_engine,
                    # Always an HF id — the GGUF's own file path is reported
                    # separately, so the UI's "Base Model ID" field stays sane.
                    "base_model": (
                        g_model_source if g_engine == "transformers" else DEFAULT_BASE_MODEL
                    ) or DEFAULT_BASE_MODEL,
                    "adapter_path": DEFAULT_ADAPTER_PATH,
                    "gguf_path": g_model_source if g_engine == "gguf" else None,
                    "load_error": g_load_error,
                }
            elif action == "reload":
                base_model = req.get("base_model", DEFAULT_BASE_MODEL)
                adapter_path = req.get("adapter_path", DEFAULT_ADAPTER_PATH)
                ok = try_load_model(base_model, adapter_path)
                res = {
                    "status": "ok" if ok else "warning",
                    "model_loaded": g_model_loaded,
                    "device": g_device_name,
                    "error": g_load_error,
                }
            elif action == "ping":
                res = {"status": "pong"}
            else:
                prompt = req.get("prompt", "")
                system_prompt = req.get("system_prompt", SYSTEM_PROMPT)
                temp = float(req.get("temperature", 0.1))
                max_tokens = int(req.get("max_new_tokens", 256))
                is_chat = bool(req.get("is_chat", False))

                res = generate_cti_response(
                    instruction=prompt,
                    system_prompt=system_prompt,
                    temperature=temp,
                    max_new_tokens=max_tokens,
                    is_chat=is_chat,
                )

            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()
        except Exception as exc:
            err_res = {"status": "error", "message": str(exc)}
            sys.stdout.write(json.dumps(err_res) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
