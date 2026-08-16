#!/usr/bin/env python3
"""
CyberSentinel Inference Service
===============================
Direct neural inference service for GRPO-trained LoRA CTI agent.
Loads base model Qwen/Qwen2.5-1.5B-Instruct + grpo_cti_tokenizer_model / adapters
on Apple Silicon GPU (MPS), CUDA, or CPU.
Communicates via JSON-RPC over stdin/stdout.
"""

from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, Optional

# Paths
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
DEFAULT_ADAPTER_PATH = os.path.join(ROOT_DIR, "grpo_cti_tokenizer_model")
FALLBACK_ADAPTER_PATH = os.path.join(ROOT_DIR, "grpo_cti_lora_adapters")

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


def extract_reasoning(text: str) -> Optional[str]:
    match = _REASONING.search(text)
    return match.group(1).strip() if match else None


def extract_answer(text: str) -> Optional[str]:
    match = _ANSWER.search(text)
    if not match:
        return None
    tid = _TID.search(match.group(1))
    return tid.group(0).upper() if tid else match.group(1).strip().upper() or None


def try_load_model(base_model: str = DEFAULT_BASE_MODEL, adapter_path: str = DEFAULT_ADAPTER_PATH):
    global g_model, g_tokenizer, g_device_name, g_model_loaded, g_load_error

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

    if g_model_loaded and g_model is not None and g_tokenizer is not None:
        try:
            import torch

            if is_chat:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": instruction},
                ]
            else:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"CTI snippet:\n{instruction}"},
                ]

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

            reasoning = extract_reasoning(raw_response)
            answer = extract_answer(raw_response)
            word_count = len(reasoning.split()) if reasoning else len(raw_response.split())

            return {
                "status": "ok",
                "engine": f"Fine-Tuned Neural Policy (Qwen2.5-1.5B LoRA on {g_device_name})",
                "device": g_device_name,
                "raw_response": raw_response,
                "reasoning": reasoning or raw_response,
                "answer": answer,
                "word_count": word_count,
                "model_loaded": True,
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


def main():
    sys.stderr.write("[CyberSentinel] Python Inference Service starting...\n")
    sys.stderr.flush()

    # Load model on startup
    try_load_model()

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
                    "base_model": DEFAULT_BASE_MODEL,
                    "adapter_path": DEFAULT_ADAPTER_PATH,
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
