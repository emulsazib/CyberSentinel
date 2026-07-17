#!/usr/bin/env python3
"""
evaluate_cti_agent.py
=====================
Standalone evaluation harness for the GRPO-trained Explainable CTI Agent.

Loads a 4-bit Qwen2.5 base model + trained LoRA adapters via transformers/peft
(no Unsloth / vLLM), runs inference on a small held-out-style probe set, and
reports:
  - Format Adherence  (both <reasoning> and <answer> tags present)
  - Accuracy          (extracted <answer> exactly matches ground_truth)
  - Reasoning Length  (word count inside <reasoning>)

Usage
-----
    python evaluate_cti_agent.py
    python evaluate_cti_agent.py --adapter_path ./final_cti_agent
    python evaluate_cti_agent.py --adapter_path ./grpo_cti_tokenizer_model \\
                                 --base_model Qwen/Qwen2.5-1.5B-Instruct

Requires: transformers, peft, torch, bitsandbytes, accelerate
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from typing import Optional

import torch
from peft import PeftModel
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)

# =============================================================================
# Configuration defaults
# =============================================================================
# Prefer the tokenizer+LoRA bundle from training when present in this repo.
# Override with --adapter_path ./final_cti_agent (or any PEFT adapter directory).
DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
DEFAULT_ADAPTER_PATH = "./grpo_cti_tokenizer_model"

# Exact system prompt used during GRPO training (malware-behavior.ipynb).
# Do NOT paraphrase — the policy was rewarded against this contract.
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

# Regexes aligned with training reward functions
_REASONING = re.compile(r"<reasoning>\s*(.*?)\s*</reasoning>", re.DOTALL | re.IGNORECASE)
_ANSWER = re.compile(r"<answer>\s*(.*?)\s*</answer>", re.DOTALL | re.IGNORECASE)
_TID = re.compile(r"T\d{4}(?:\.\d{3})?", re.IGNORECASE)

# Generation hyperparams (user-requested defaults)
MAX_NEW_TOKENS = 256
TEMPERATURE = 0.1


# =============================================================================
# Hardcoded probe set (unseen-style CTI snippets across ATT&CK tactics)
# =============================================================================
# Each sample: instruction = raw CTI / log text; ground_truth = MITRE ID.
TEST_SAMPLES = [
    {
        # Execution — Command and Scripting Interpreter: PowerShell
        "instruction": (
            "Process 'cmd.exe' spawned 'powershell.exe -enc JABzAD0A...' "
            "and immediately executed a Base64-encoded download cradle."
        ),
        "ground_truth": "T1059.001",
    },
    {
        # Persistence — Boot or Logon Autostart Execution: Registry Run Keys
        "instruction": (
            "The malware wrote a Run key under HKCU\\Software\\Microsoft\\Windows"
            "\\CurrentVersion\\Run pointing to payload.exe so it starts at logon."
        ),
        "ground_truth": "T1547.001",
    },
    {
        # Defense Evasion — Obfuscated Files or Information
        "instruction": (
            "The dropper stored its second-stage payload as XOR-encrypted blobs "
            "inside a PE resource section and only decrypted them in memory."
        ),
        "ground_truth": "T1027",
    },
    {
        # Defense Evasion / Privilege Escalation — Process Injection
        "instruction": (
            "After gaining a foothold, the implant allocated RWX memory in "
            "explorer.exe via VirtualAllocEx and injected shellcode with "
            "CreateRemoteThread."
        ),
        "ground_truth": "T1055",
    },
    {
        # Command and Control — Application Layer Protocol: Web Protocols
        "instruction": (
            "Beaconing was observed as periodic HTTPS POST requests to "
            "cdn-updates.example[.]com/api/v2/checkin with a custom User-Agent."
        ),
        "ground_truth": "T1071.001",
    },
]


# =============================================================================
# Data structures
# =============================================================================
@dataclass
class EvalResult:
    """Per-sample evaluation outcome."""

    instruction: str
    ground_truth: str
    raw_response: str
    reasoning: Optional[str]
    answer: Optional[str]
    format_pass: bool
    accuracy_pass: bool
    reasoning_word_count: int


# =============================================================================
# Model / tokenizer loading
# =============================================================================
def load_model_and_tokenizer(
    base_model: str,
    adapter_path: str,
) -> tuple:
    """
    Load a 4-bit base CausalLM and wrap it with trained LoRA adapters.

    BitsAndBytesConfig keeps the footprint suitable for ~15–24 GB GPUs.
    The PEFT adapter directory should contain adapter_config.json + weights
    (e.g. adapter_model.safetensors). Prefer grpo_cti_tokenizer_model/ so the
    chat template matches training.
    """
    print(f"[setup] Loading 4-bit base model: {base_model}")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        # T4 has no bf16; fp16 is the safe default across consumer GPUs.
        bnb_4bit_compute_dtype=torch.float16,
    )

    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )

    print(f"[setup] Attaching LoRA adapters from: {adapter_path}")
    model = PeftModel.from_pretrained(model, adapter_path)
    model.eval()

    # Prefer tokenizer shipped with the adapter bundle (chat template match).
    print(f"[setup] Loading tokenizer from: {adapter_path}")
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            adapter_path,
            trust_remote_code=True,
        )
    except Exception as exc:  # noqa: BLE001
        print(
            f"[setup] Adapter tokenizer unavailable ({exc!r}); "
            f"falling back to base model tokenizer."
        )
        tokenizer = AutoTokenizer.from_pretrained(
            base_model,
            trust_remote_code=True,
        )

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    return model, tokenizer


# =============================================================================
# Prompt formatting & generation
# =============================================================================
def format_prompt(instruction: str, tokenizer) -> str:
    """
    Build the chat-formatted prompt using the same roles/content as training.

    Training mapped each row to:
      system -> SYSTEM_PROMPT
      user   -> "CTI snippet:\\n{text}"
    """
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"CTI snippet:\n{instruction}"},
    ]
    # Qwen chat template; add_generation_prompt=True appends the assistant turn.
    return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )


@torch.inference_mode()
def generate_response(
    model,
    tokenizer,
    instruction: str,
    max_new_tokens: int = MAX_NEW_TOKENS,
    temperature: float = TEMPERATURE,
) -> str:
    """Run a single greedy-ish generation and return only the new assistant text."""
    prompt_text = format_prompt(instruction, tokenizer)
    inputs = tokenizer(prompt_text, return_tensors="pt")
    inputs = {k: v.to(model.device) for k, v in inputs.items()}

    # temperature=0.1 keeps reasoning somewhat deterministic while still sampling.
    # For fully greedy decoding, set do_sample=False instead.
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_new_tokens,
        do_sample=True,
        temperature=temperature,
        top_p=0.9,
        pad_token_id=tokenizer.pad_token_id,
        eos_token_id=tokenizer.eos_token_id,
    )

    # Decode only newly generated tokens (strip the prompt prefix).
    prompt_len = inputs["input_ids"].shape[-1]
    generated_ids = outputs[0][prompt_len:]
    return tokenizer.decode(generated_ids, skip_special_tokens=True).strip()


# =============================================================================
# Parsing & metrics
# =============================================================================
def extract_reasoning(text: str) -> Optional[str]:
    """Return text inside the first <reasoning>...</reasoning> block, or None."""
    match = _REASONING.search(text)
    return match.group(1).strip() if match else None


def extract_answer(text: str) -> Optional[str]:
    """
    Return the normalized MITRE ID inside <answer>...</answer>, or None.

    Mirrors training's _extract_id: pull the tag body, then find T####(.###)?.
    """
    match = _ANSWER.search(text)
    if not match:
        return None
    tid = _TID.search(match.group(1))
    return tid.group(0).upper() if tid else match.group(1).strip().upper() or None


def word_count(text: Optional[str]) -> int:
    """Simple whitespace word count for the reasoning section."""
    if not text:
        return 0
    return len(text.split())


def evaluate_sample(
    model,
    tokenizer,
    sample: dict,
    max_new_tokens: int,
    temperature: float,
) -> EvalResult:
    """Generate + parse + score one test sample."""
    raw = generate_response(
        model,
        tokenizer,
        sample["instruction"],
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )
    reasoning = extract_reasoning(raw)
    answer = extract_answer(raw)

    # Format Adherence: BOTH tag pairs must be present and non-empty.
    format_pass = bool(reasoning) and bool(answer)

    # Accuracy: exact match against ground_truth (case-insensitive).
    truth = sample["ground_truth"].strip().upper()
    accuracy_pass = answer is not None and answer == truth

    return EvalResult(
        instruction=sample["instruction"],
        ground_truth=truth,
        raw_response=raw,
        reasoning=reasoning,
        answer=answer,
        format_pass=format_pass,
        accuracy_pass=accuracy_pass,
        reasoning_word_count=word_count(reasoning),
    )


# =============================================================================
# Reporting
# =============================================================================
def _pass_fail(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def print_case_report(index: int, total: int, result: EvalResult) -> None:
    """Pretty-print one test case to the console."""
    divider = "=" * 72
    thin = "-" * 72
    print(divider)
    print(f" TEST CASE {index}/{total}")
    print(divider)
    print("Input Log:")
    print(f"  {result.instruction}")
    print(thin)
    print(f"Ground Truth MITRE ID : {result.ground_truth}")
    print(f"Extracted Answer      : {result.answer or '(none)'}")
    print(f"Format Adherence      : {_pass_fail(result.format_pass)}")
    print(f"Accuracy              : {_pass_fail(result.accuracy_pass)}")
    print(f"Reasoning Word Count  : {result.reasoning_word_count}")
    print(thin)
    print("Extracted Reasoning:")
    if result.reasoning:
        for line in result.reasoning.splitlines() or [result.reasoning]:
            print(f"  {line}")
    else:
        print("  (none — <reasoning> tags missing or empty)")
    print(thin)
    print("Raw Model Output:")
    for line in result.raw_response.splitlines() or [result.raw_response]:
        print(f"  {line}")
    print()


def print_summary(results: list[EvalResult]) -> None:
    """Print aggregate Accuracy % and Format Adherence %."""
    n = len(results)
    if n == 0:
        print("[summary] No results to summarize.")
        return

    fmt_ok = sum(1 for r in results if r.format_pass)
    acc_ok = sum(1 for r in results if r.accuracy_pass)
    avg_words = sum(r.reasoning_word_count for r in results) / n

    print("=" * 72)
    print(" FINAL SUMMARY")
    print("=" * 72)
    print(f"  Samples evaluated     : {n}")
    print(f"  Format Adherence      : {fmt_ok}/{n}  ({100.0 * fmt_ok / n:.1f}%)")
    print(f"  Accuracy              : {acc_ok}/{n}  ({100.0 * acc_ok / n:.1f}%)")
    print(f"  Avg Reasoning Length  : {avg_words:.1f} words")
    print("=" * 72)


# =============================================================================
# CLI entrypoint
# =============================================================================
def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate a GRPO-trained CTI LoRA agent on probe CTI samples.",
    )
    parser.add_argument(
        "--base_model",
        default=DEFAULT_BASE_MODEL,
        help=f"HF base model id (default: {DEFAULT_BASE_MODEL})",
    )
    parser.add_argument(
        "--adapter_path",
        default=DEFAULT_ADAPTER_PATH,
        help=(
            "Directory with trained LoRA adapters "
            f"(default: {DEFAULT_ADAPTER_PATH}; e.g. ./final_cti_agent)"
        ),
    )
    parser.add_argument(
        "--max_new_tokens",
        type=int,
        default=MAX_NEW_TOKENS,
        help=f"Generation length budget (default: {MAX_NEW_TOKENS})",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=TEMPERATURE,
        help=f"Sampling temperature (default: {TEMPERATURE})",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)

    if not torch.cuda.is_available():
        print(
            "[warn] CUDA not available — 4-bit BitsAndBytes usually requires a GPU. "
            "Proceeding anyway; expect failure or very slow CPU fallback.",
            file=sys.stderr,
        )

    model, tokenizer = load_model_and_tokenizer(args.base_model, args.adapter_path)

    results: list[EvalResult] = []
    total = len(TEST_SAMPLES)
    print(f"\n[eval] Running {total} probe samples "
          f"(max_new_tokens={args.max_new_tokens}, temperature={args.temperature})\n")

    for i, sample in enumerate(TEST_SAMPLES, start=1):
        print(f"[eval] Generating response for sample {i}/{total}...")
        result = evaluate_sample(
            model,
            tokenizer,
            sample,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
        )
        results.append(result)
        print_case_report(i, total, result)

    print_summary(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
