#!/usr/bin/env python3
"""
CyberSentinel — GRPO training on RunPod (single NVIDIA RTX A6000, 48GB, Ampere).
================================================================================

Teaches Qwen3-4B-Instruct-2507 to map a CTI snippet to one MITRE ATT&CK technique
ID, with auditable reasoning, using GRPO (Group Relative Policy Optimization).

Why GRPO instead of PPO
-----------------------
PPO needs a separate Value/Critic model (typically as large as the policy) to
estimate the expected reward of every token. GRPO removes the Critic entirely:
for each prompt it samples a *group* of G completions, scores each with cheap
deterministic Python reward functions, and computes each completion's advantage
RELATIVE to the group:

        A_i = (r_i - mean(r)) / std(r)

CONSEQUENCE: the entire learning signal lives in the *spread* within a group.
Sample too greedily and all G completions come out near-identical, std(r) ~ 0,
every advantage collapses to ~0, and the step contributes no gradient — the run
looks perfectly stable while learning nothing. That is why --temperature defaults
to 0.9 and why reward_std is the first metric to watch.

Hardware notes (RTX A6000 vs the earlier Kaggle T4 target)
----------------------------------------------------------
  * Ampere (SM 8.6) has native bfloat16 — used instead of fp16. Wider dynamic
    range than fp16 at the same memory cost, which matters for RL where reward
    scaling can push activations around.
  * FlashInfer is ENABLED. The T4 build needed UNSLOTH_VLLM_NO_FLASHINFER=1
    because vLLM's JIT link step failed with "cannot find -lcuda" on Kaggle;
    on RunPod's CUDA 12.4 image the native sampling kernels build fine.
  * 48GB of VRAM means gpu_memory_utilization can go to 0.85 and G can reach 8.

Usage
-----
    # headless, inside tmux
    tmux new -s cti
    python train_runpod.py 2>&1 | tee /workspace/train.log

    # full epoch (~3725 steps at 4 prompts/step) instead of the 2000-step default
    python train_runpod.py --full-epoch

    # resume after a disconnect
    python train_runpod.py --resume

    # convert an already-trained merged checkpoint to GGUF, no training
    python train_runpod.py --export-only

Requires: unsloth, vllm, trl, transformers>=4.51 (Qwen3), peft, datasets.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional

# =============================================================================
# Paths — RunPod persistent volume
# =============================================================================
WORKSPACE = os.environ.get("CTI_WORKSPACE", "/workspace")
OUTPUT_DIR = os.path.join(WORKSPACE, "outputs")            # trainer checkpoints
ADAPTER_DIR = os.path.join(WORKSPACE, "grpo_cti_adapters")  # PEFT LoRA + tokenizer
LORA_DIR = os.path.join(WORKSPACE, "grpo_cti_lora")         # Unsloth save_lora
MERGED_DIR = os.path.join(WORKSPACE, "grpo_cti_merged")     # merged 16-bit
GGUF_DIR = os.path.join(WORKSPACE, "grpo_cti_gguf")         # quantised GGUF
LLAMA_CPP_DIR = os.path.join(WORKSPACE, "llama.cpp")        # conversion toolchain

GGUF_BASENAME = "cybersentinel-cti"

ALL_DIRS = [OUTPUT_DIR, ADAPTER_DIR, LORA_DIR, MERGED_DIR, GGUF_DIR]

# =============================================================================
# Prompt contract
# =============================================================================
# Byte-identical to backend/inference_service.py and evaluate_cti_agent.py.
# The policy is rewarded against this exact text — if you change it here, change
# it there too, or the served model is prompted differently from how it trained.
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

# Strict full-output contract: <reasoning>...</reasoning><answer>...</answer>
_STRICT_FORMAT = re.compile(
    r"^\s*<reasoning>.*?</reasoning>\s*<answer>.*?</answer>\s*$", re.DOTALL
)
_ANSWER = re.compile(r"<answer>\s*(.*?)\s*</answer>", re.DOTALL)
_TID = re.compile(r"T\d{4}(?:\.\d{3})?", re.IGNORECASE)


# =============================================================================
# Reward functions  (pure Python: deterministic, free, nothing to train or drift)
# =============================================================================
def _completion_text(completion) -> str:
    """Extract the assistant string from one completion.

    Tolerates both shapes TRL may hand us: conversational (list of message dicts)
    and plain text (a bare string), since that has changed across TRL versions.
    """
    if isinstance(completion, str):
        return completion
    if isinstance(completion, dict):
        return completion.get("content", "")
    if isinstance(completion, list) and completion:
        first = completion[0]
        if isinstance(first, dict):
            return first.get("content", "")
        return str(first)
    return ""


def format_reward_func(prompts, completions, **kwargs) -> List[float]:
    """1.0 if the completion strictly matches the required XML format, else 0.0."""
    return [
        1.0 if _STRICT_FORMAT.match(_completion_text(c)) else 0.0 for c in completions
    ]


def _extract_id(text: str) -> Optional[str]:
    """Return the normalized technique ID inside <answer>, or None."""
    m = _ANSWER.search(text)
    if not m:
        return None
    hit = _TID.search(m.group(1))
    return hit.group(0).upper() if hit else None


def correctness_reward_func(prompts, completions, ground_truth=None, **kwargs) -> List[float]:
    """+2.0 if the predicted ID exactly matches ANY ground-truth ID, else -1.0.

    Multi-label aware: a row may list several valid techniques. Exact match is
    required, so T1059.001 does NOT satisfy a bare T1059 (and vice versa) unless
    that exact ID is in the label list. Mirrors evaluate_cti_agent.py.
    """
    if ground_truth is None:
        ground_truth = [[] for _ in completions]
    rewards = []
    for c, truth in zip(completions, ground_truth):
        pred = _extract_id(_completion_text(c))
        truth_set = {t.strip().upper() for t in truth}
        rewards.append(2.0 if pred is not None and pred in truth_set else -1.0)
    return rewards


def soft_format_reward_func(prompts, completions, **kwargs) -> List[float]:
    """Partial credit for producing the tags at all (0.0 .. 0.5).

    Cold-start scaffolding: before the policy reliably emits the full contract this
    keeps some gradient flowing instead of a flat -1.0 everywhere. Drop it once
    format_reward is consistently near 1.0.
    """
    rewards = []
    for c in completions:
        text = _completion_text(c)
        score = 0.0
        if "<reasoning>" in text and "</reasoning>" in text:
            score += 0.25
        if "<answer>" in text and "</answer>" in text:
            score += 0.25
        rewards.append(score)
    return rewards


REWARD_FUNCS = [format_reward_func, correctness_reward_func, soft_format_reward_func]


def run_reward_smoke_test(verbose: bool = True) -> None:
    """Verify the scoring before spending GPU-hours. Needs no GPU, takes ms.

    A broken reward function is invisible during training — you just watch a flat
    line for hours — so this runs by default before the trainer is built.
    """
    def msg(text):
        return [{"role": "assistant", "content": text}]

    good = msg(
        "<reasoning>cmd spawns an encoded powershell child; this is a command "
        "interpreter abuse pattern</reasoning>\n<answer>T1059.001</answer>"
    )
    bad_format = msg("The answer is T1059.001")
    wrong_id = msg("<reasoning>looks like host discovery</reasoning>\n<answer>T1082</answer>")
    parent_only = msg("<reasoning>powershell use</reasoning>\n<answer>T1059</answer>")
    gt = [["T1059.001"]]

    # strict format
    assert format_reward_func(None, [good]) == [1.0]
    assert format_reward_func(None, [bad_format]) == [0.0]
    assert format_reward_func(None, [wrong_id]) == [1.0], "format is judged independently of correctness"

    # correctness
    assert correctness_reward_func(None, [good], ground_truth=gt) == [2.0]
    assert correctness_reward_func(None, [wrong_id], ground_truth=gt) == [-1.0]
    assert correctness_reward_func(None, [parent_only], ground_truth=gt) == [-1.0], \
        "T1059 must not be accepted for T1059.001"
    assert correctness_reward_func(None, [wrong_id], ground_truth=[["T1082", "T1059.001"]]) == [2.0]
    assert correctness_reward_func(None, [bad_format], ground_truth=gt) == [-1.0]

    # soft format
    assert soft_format_reward_func(None, [good]) == [0.5]
    assert soft_format_reward_func(None, [bad_format]) == [0.0]
    assert soft_format_reward_func(None, [msg("<answer>T1059</answer>")]) == [0.25]

    # completion-shape tolerance
    plain = "<reasoning>x</reasoning>\n<answer>T1059.001</answer>"
    assert format_reward_func(None, [plain]) == [1.0], "bare-string completions must work"
    assert correctness_reward_func(None, [plain], ground_truth=gt) == [2.0]

    # batch ordering preserved
    batch = [good, wrong_id, bad_format]
    batch_gt = [["T1059.001"]] * 3
    assert correctness_reward_func(None, batch, ground_truth=batch_gt) == [2.0, -1.0, -1.0]

    if verbose:
        print("[rewards] smoke test OK — format(0/1) + correctness(-1/+2) + soft(0..0.5)")


# =============================================================================
# Dataset
# =============================================================================
def parse_labels(raw) -> List[str]:
    """Turn a stringified label list into a clean list of technique IDs."""
    import ast

    if isinstance(raw, list):
        ids = raw
    else:
        try:
            ids = ast.literal_eval(str(raw))
        except (ValueError, SyntaxError):
            ids = [raw]  # sometimes labels arrive as a bare string like "T1057"
        if not isinstance(ids, list):
            ids = [ids]
    return [str(i).strip().upper() for i in ids if str(i).strip()]


def to_grpo_row(example) -> Dict[str, Any]:
    """Map a raw dataset row into the conversational format GRPOTrainer wants."""
    return {
        "prompt": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"CTI snippet:\n{example['text1']}"},
        ],
        # extra columns are forwarded verbatim to the reward functions as kwargs
        "ground_truth": parse_labels(example["labels"]),
    }


def synthetic_dataset():
    """8 fake rows for a plumbing smoke test. NEVER a real training run."""
    from datasets import Dataset

    samples = [
        ("Process 'cmd.exe' spawned 'powershell.exe -enc JABzAD0A...'.", "T1059.001"),
        ("The malware queried the registry to enumerate running processes.", "T1057"),
        ("A scheduled task was created to run the payload every 10 minutes.", "T1053.005"),
        ("Credentials were dumped from LSASS memory using a custom tool.", "T1003.001"),
        ("The sample established a TLS connection to 198.51.100.34:443 for C2.", "T1071.001"),
        ("Files in the user directory were encrypted and a ransom note dropped.", "T1486"),
        ("The binary copied itself to the Startup folder for persistence.", "T1547.001"),
        ("It executed 'whoami' and 'ipconfig /all' to profile the host.", "T1082"),
    ]
    return Dataset.from_list(
        [to_grpo_row({"text1": t, "labels": f"['{tid}']"}) for t, tid in samples]
    )


def build_dataset(dataset_id: str, split: str, allow_synthetic: bool = False):
    """Load Security-TTP-Mapping.

    Download failure is tolerated only if you opt in; a schema/parse failure ALWAYS
    raises. Silently training on 8 synthetic rows looks identical to a successful
    run until the metrics come back garbage, which is the worst outcome available.
    """
    from datasets import load_dataset

    try:
        raw = load_dataset(dataset_id, split=split)
    except Exception as exc:  # noqa: BLE001 — network/download only
        if not allow_synthetic:
            raise RuntimeError(
                f"Could not download {dataset_id} split={split!r}: {exc!r}. "
                "Check the pod's network, or pass --allow-synthetic to run a "
                "plumbing test on 8 fake rows (NOT a real training run)."
            ) from exc
        print(f"[data] download failed ({exc!r}); using synthetic fallback — NOT a real run")
        return synthetic_dataset()

    missing = {"text1", "labels"} - set(raw.column_names)
    if missing:
        raise KeyError(
            f"Dataset schema changed: missing {missing}. Found {raw.column_names}. "
            "Update to_grpo_row() before training."
        )

    # NOTE: no try/except around .map — a parse error must surface, not degrade.
    ds = raw.map(to_grpo_row, remove_columns=raw.column_names)
    ds = ds.filter(lambda r: len(r["ground_truth"]) > 0)
    print(f"[data] {split}: {len(ds)} rows after label parsing")
    return ds


def drop_overlong_prompts(ds, tokenizer, max_prompt_length: int):
    """Remove rows whose rendered prompt exceeds max_prompt_length tokens.

    TRL truncates over-long prompts from the LEFT, which eats the system prompt —
    the very text the format reward grades against. Those rows would train the
    model against a contract it never saw. text1 reaches ~2500 chars, so this is
    not hypothetical.
    """
    def fits(row):
        text = tokenizer.apply_chat_template(
            row["prompt"], tokenize=False, add_generation_prompt=True
        )
        return len(tokenizer(text)["input_ids"]) <= max_prompt_length

    before = len(ds)
    ds = ds.filter(fits)
    print(f"[data] dropped {before - len(ds)} over-long prompts ({len(ds)} remain)")
    return ds


# =============================================================================
# Environment / model
# =============================================================================
def configure_environment(args) -> None:
    """Set every env var Unsloth reads. MUST run before `import unsloth`."""
    if args.gpu is not None:
        os.environ["CUDA_VISIBLE_DEVICES"] = str(args.gpu)

    # Standby lets vLLM (generation) and the trainer (backprop) share one memory
    # pool instead of reserving ~50/50: the KV cache is dropped when switching
    # phases while weights stay resident. Costs <1% throughput.
    if not args.no_standby:
        os.environ["UNSLOTH_VLLM_STANDBY"] = "1"

    # FlashInfer stays ENABLED on Ampere. The Kaggle T4 build had to disable it
    # (vLLM's JIT link step failed with "cannot find -lcuda"); RunPod's CUDA 12.4
    # image builds the native sampling kernels without complaint. --no-flashinfer
    # is here only for anyone running this on Turing.
    if args.no_flashinfer:
        os.environ["UNSLOTH_VLLM_NO_FLASHINFER"] = "1"

    for d in ALL_DIRS:
        os.makedirs(d, exist_ok=True)


def resolve_precision(requested: str) -> str:
    """Return "bf16" or "fp16". Ampere and newer support bf16 natively."""
    import torch

    if requested != "auto":
        return requested

    if torch.cuda.is_available() and torch.cuda.is_bf16_supported():
        return "bf16"
    print("[precision] bf16 unsupported on this GPU — falling back to fp16")
    return "fp16"


def report_gpu() -> float:
    """Print GPU details, enforce the vLLM floor, return usable VRAM in GB."""
    import torch

    if not torch.cuda.is_available():
        raise SystemExit("No CUDA device visible. This script needs a GPU.")

    name = torch.cuda.get_device_name(0)
    cc = torch.cuda.get_device_capability(0)
    vram = torch.cuda.get_device_properties(0).total_memory / 1e9
    print(f"[gpu] {name}  cc={cc[0]}.{cc[1]}  vram={vram:.1f} GB  torch={torch.__version__}")

    # vLLM hard-requires compute capability >= 7.0 (A6000/3090 = 8.6, T4 = 7.5, P100 = 6.0)
    if cc[0] < 7:
        raise SystemExit(
            f"{name} has compute capability {cc[0]}.{cc[1]}; vLLM requires >= 7.0."
        )
    return vram


def auto_gpu_memory_utilization(vram_gb: float) -> float:
    """Pick vLLM's pool share from the card actually present.

    vLLM reserves this fraction up front for weights + KV cache; whatever is left
    has to hold the LoRA backward pass, optimizer state, and activations. The
    defaults were tuned for a 48GB A6000, where 0.85 still leaves ~7GB. On a 24GB
    card 0.85 leaves ~3.5GB and OOMs during the first training step, so scale the
    share down as the card shrinks. Explicit --gpu-memory-utilization always wins.
    """
    # Thresholds sit just under the nominal size: a "40GB" A100 reports ~39.6.
    if vram_gb >= 38:      # A6000 48GB, A100 40/80GB
        return 0.85
    if vram_gb >= 20:      # RTX 3090 / 4090 24GB, A5000 24GB
        return 0.70
    return 0.60            # 16GB and below (T4, V100)


INSTALL_HINT = """
Missing dependency: {missing}

Install the training stack into the environment that is actually running this
code, then restart (Unsloth patches torch at import time):

  shell / tmux:   pip install unsloth vllm
  Jupyter cell:   %pip install unsloth vllm     <- installs into THIS kernel,
                                                   then Kernel -> Restart Kernel

A JupyterLab kernel frequently runs a different Python than the terminal's `pip`,
so `!pip install` in a terminal can leave the notebook's kernel without it. `%pip`
targets the running kernel and avoids that mismatch.

Current interpreter: {exe}
"""


CUDA_MISMATCH_HINT = """
vLLM was built against a different CUDA than your PyTorch.

  torch CUDA : {torch_cuda}   (torch {torch_version})
  failure    : {error}

vLLM's default PyPI wheel targets CUDA 12.9/13.0. If torch on this pod is cu128,
that wheel wants libnvrtc.so.13 / libcudart.so.13, which the CUDA 12 runtime does
not provide. Install the vLLM build matching your torch:

  VLLM_VERSION=$(python -c "import vllm; print(vllm.__version__)")
  pip install "https://github.com/vllm-project/vllm/releases/download/v${{VLLM_VERSION}}/vllm-${{VLLM_VERSION}}+cu{cuda_tag}-cp38-abi3-manylinux_2_28_$(uname -m).whl" \\
      --extra-index-url https://download.pytorch.org/whl/cu{cuda_tag}

If that URL 404s (the manylinux tag varies between releases):

  pip install -U uv
  uv pip install --system -U vllm --torch-backend=cu{cuda_tag} \\
      --extra-index-url https://wheels.vllm.ai/nightly/cu{cuda_tag}

Verify afterwards:  python -c "import vllm; print(vllm.__version__)"
"""


def require_dependencies() -> None:
    """Fail early with an actionable message instead of a bare ModuleNotFoundError."""
    import importlib.util

    missing = [
        name for name in ("unsloth", "vllm", "trl", "datasets", "torch")
        if importlib.util.find_spec(name) is None
    ]
    if missing:
        raise SystemExit(INSTALL_HINT.format(missing=", ".join(missing), exe=sys.executable))

    check_cuda_runtime_match()


def check_cuda_runtime_match() -> None:
    """Catch a vLLM/torch CUDA mismatch before the model load, not during it.

    Unsloth calls patch_vllm() deep inside FastLanguageModel.from_pretrained, so a
    mismatched wheel surfaces as a bare `ImportError: libnvrtc.so.13` several
    minutes in. This probes the same import up front.
    """
    import torch

    torch_cuda = torch.version.cuda or "cpu"
    cuda_tag = torch_cuda.replace(".", "")[:3] or "128"

    try:
        # the exact import that fails on a mismatched wheel
        from vllm.device_allocator.cumem import CuMemAllocator  # noqa: F401
    except ImportError as exc:
        if any(lib in str(exc) for lib in ("libnvrtc", "libcudart", "libcuda", ".so.")):
            raise SystemExit(CUDA_MISMATCH_HINT.format(
                torch_cuda=torch_cuda,
                torch_version=torch.__version__,
                error=exc,
                cuda_tag=cuda_tag,
            )) from exc
        # anything else (module moved between vLLM versions) is not our problem here
        print(f"[deps] note: could not probe vllm cumem allocator ({exc})")
    except Exception as exc:  # noqa: BLE001 — probing must never block a good install
        print(f"[deps] note: vllm probe skipped ({type(exc).__name__}: {exc})")
    else:
        print(f"[deps] vllm matches torch CUDA {torch_cuda}")


def load_policy(args, precision: str):
    """Load the 4-bit base + attach LoRA adapters. Imports Unsloth lazily."""
    import torch

    try:
        from unsloth import FastLanguageModel
    except ModuleNotFoundError as exc:
        raise SystemExit(INSTALL_HINT.format(missing=exc.name, exe=sys.executable)) from exc

    dtype = torch.bfloat16 if precision == "bf16" else torch.float16

    print(f"[model] loading {args.model} (4-bit, dtype={dtype})")
    try:
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.model,
            max_seq_length=args.max_seq_length,
            load_in_4bit=True,
            fast_inference=True,      # generation through vLLM — GRPO's bottleneck
            max_lora_rank=args.lora_rank,
            gpu_memory_utilization=args.gpu_memory_utilization,
            dtype=dtype,
        )
    except ImportError as exc:
        # Unsloth patches vLLM inside from_pretrained; a CUDA-mismatched wheel
        # only blows up here, minutes into the run.
        if any(lib in str(exc) for lib in ("libnvrtc", "libcudart", "libcuda", ".so.")):
            torch_cuda = torch.version.cuda or "cpu"
            raise SystemExit(CUDA_MISMATCH_HINT.format(
                torch_cuda=torch_cuda,
                torch_version=torch.__version__,
                error=exc,
                cuda_tag=torch_cuda.replace(".", "")[:3] or "128",
            )) from exc
        raise

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",   # attention projections
            "gate_proj", "up_proj", "down_proj",      # MLP projections
        ],
        lora_alpha=args.lora_rank,
        use_gradient_checkpointing="unsloth",
        random_state=args.seed,
    )

    print(f"[model] LoRA rank {args.lora_rank} attached; "
          f"reserved VRAM {torch.cuda.memory_reserved() / 1e9:.2f} GB")
    return model, tokenizer


def build_training_args(args, precision: str, n_rows: int):
    """Assemble GRPOConfig, dropping fields this TRL release does not accept."""
    import dataclasses

    import trl
    from trl import GRPOConfig

    # TRL asserts: (per_device_batch * grad_accum * n_gpus) % num_generations == 0
    per_device_batch = args.per_device_batch or args.num_generations
    effective = per_device_batch * args.grad_accum
    if effective % args.num_generations != 0:
        raise SystemExit(
            f"per_device_batch({per_device_batch}) * grad_accum({args.grad_accum}) "
            f"= {effective} is not divisible by num_generations({args.num_generations}). "
            "Adjust them together."
        )

    prompts_per_step = effective // args.num_generations
    steps_per_epoch = max(n_rows // prompts_per_step, 1)

    max_steps = steps_per_epoch if args.full_epoch else args.max_steps
    if args.full_epoch:
        print(f"[config] --full-epoch: {steps_per_epoch} steps "
              f"({n_rows} rows / {prompts_per_step} prompts per step)")

    cfg = dict(
        output_dir=args.output_dir,
        seed=args.seed,

        # --- GRPO group sampling ---
        num_generations=args.num_generations,
        max_prompt_length=args.max_prompt_length,
        max_completion_length=args.max_completion_length,
        use_vllm=True,

        # THE important knob — see the module docstring. Greedy sampling collapses
        # the group, zeroes every advantage, and silently kills the gradient.
        temperature=args.temperature,
        top_p=args.top_p,

        # KL penalty toward the frozen reference policy. Explicit so the value is
        # visible in the write-up; raise it if the policy drifts into degenerate
        # high-reward text.
        beta=args.beta,

        # --- batching ---
        per_device_train_batch_size=per_device_batch,
        gradient_accumulation_steps=args.grad_accum,

        # --- precision: Ampere native bf16 ---
        bf16=(precision == "bf16"),
        fp16=(precision == "fp16"),

        # --- optimization ---
        learning_rate=args.learning_rate,
        optim="adamw_8bit",
        warmup_ratio=0.1,
        lr_scheduler_type="cosine",
        weight_decay=0.1,
        max_grad_norm=0.1,

        # --- duration / logging / checkpointing ---
        max_steps=max_steps,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        save_total_limit=args.save_total_limit,
        report_to=args.report_to,
    )

    # GRPOConfig's fields move between TRL releases (recent versions added
    # vllm_mode="colocate", changed the num_generations default to 8, ...) and we
    # deliberately do not pin TRL, so drop anything unsupported rather than dying
    # with a TypeError after the model is already on the GPU.
    supported = {f.name for f in dataclasses.fields(GRPOConfig)}
    dropped = {k: v for k, v in cfg.items() if k not in supported}
    cfg = {k: v for k, v in cfg.items() if k in supported}
    if dropped:
        print(f"[config] WARNING: unsupported by trl {trl.__version__}, dropped: {dropped}")
        print("[config] check whether these were renamed before trusting the run.")

    print(f"[config] {max_steps} steps x {prompts_per_step} prompts/step x G={args.num_generations}")
    print(f"[config] ~{max_steps * prompts_per_step} prompts seen "
          f"({max_steps * prompts_per_step / max(n_rows, 1):.2f} epochs of {n_rows} rows)")
    print(f"[config] precision={precision} temperature={args.temperature} beta={args.beta}")

    return GRPOConfig(**cfg)


# =============================================================================
# Saving + GGUF export
# =============================================================================
def save_artifacts(model, tokenizer) -> None:
    """LoRA adapters (for evaluate_cti_agent.py) + merged 16-bit (GGUF input)."""
    for d in (LORA_DIR, ADAPTER_DIR, MERGED_DIR):
        os.makedirs(d, exist_ok=True)

    model.save_lora(LORA_DIR)
    model.save_pretrained(ADAPTER_DIR)
    tokenizer.save_pretrained(ADAPTER_DIR)
    print(f"[save] LoRA adapters -> {ADAPTER_DIR}")

    # GGUF carries ONE set of weights, so LoRA must be merged into the base first.
    # Keep this directory even after a successful GGUF export: it is the input for
    # redoing the conversion without retraining.
    model.save_pretrained_merged(MERGED_DIR, tokenizer, save_method="merged_16bit")
    print(f"[save] merged 16-bit -> {MERGED_DIR}")


def _sh(cmd: List[str]) -> None:
    """Run a command, streaming output, raising on non-zero exit."""
    print(f"\n$ {' '.join(cmd)}\n", flush=True)
    subprocess.run(cmd, check=True)


def convert_with_llama_cpp(merged_dir: str, gguf_dir: str, quant: str) -> str:
    """Clone + CMake-build llama.cpp, convert merged fp16 -> GGUF, then quantise.

    Used when Unsloth's save_pretrained_gguf is unavailable or fails (there is a
    known upstream issue where it rejects `quantization_method`). Only the
    llama-quantize target is built, and with GGML_CUDA=OFF, because quantisation
    is a CPU job — building the CUDA backend here would waste several minutes.
    """
    os.makedirs(gguf_dir, exist_ok=True)
    f16 = os.path.join(gguf_dir, f"{GGUF_BASENAME}-f16.gguf")
    out = os.path.join(gguf_dir, f"{GGUF_BASENAME}-{quant}.gguf")
    build = os.path.join(LLAMA_CPP_DIR, "build")

    if not os.path.isdir(LLAMA_CPP_DIR):
        _sh(["git", "clone", "--depth", "1",
             "https://github.com/ggml-org/llama.cpp", LLAMA_CPP_DIR])

    _sh([sys.executable, "-m", "pip", "install", "-q", "-r",
         os.path.join(LLAMA_CPP_DIR, "requirements", "requirements-convert_hf_to_gguf.txt")])

    _sh([sys.executable, os.path.join(LLAMA_CPP_DIR, "convert_hf_to_gguf.py"),
         merged_dir, "--outfile", f16, "--outtype", "f16"])

    _sh(["cmake", "-S", LLAMA_CPP_DIR, "-B", build,
         "-DLLAMA_CURL=OFF", "-DGGML_CUDA=OFF", "-DCMAKE_BUILD_TYPE=Release"])
    _sh(["cmake", "--build", build, "--target", "llama-quantize",
         "-j", str(os.cpu_count() or 4)])

    quantize_bin = os.path.join(build, "bin", "llama-quantize")
    if not os.path.exists(quantize_bin):          # older layouts drop it in build/
        quantize_bin = os.path.join(build, "llama-quantize")
    _sh([quantize_bin, f16, out, quant.upper()])

    # the f16 intermediate is ~8GB; drop it once the quantised file exists
    if os.path.exists(out) and os.path.exists(f16):
        os.remove(f16)
    return out


def export_gguf(model=None, tokenizer=None, quant: str = "q4_k_m",
                merged_dir: str = MERGED_DIR, gguf_dir: str = GGUF_DIR) -> str:
    """Produce {gguf_dir}/cybersentinel-cti-{quant}.gguf. Returns its path.

    Tries Unsloth's one-liner first (when a live model is in memory), then falls
    back to driving llama.cpp directly from the merged weights on disk.
    """
    os.makedirs(gguf_dir, exist_ok=True)
    canonical = os.path.join(gguf_dir, f"{GGUF_BASENAME}-{quant}.gguf")

    if model is not None:
        try:
            model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method=quant)
            produced = sorted(glob.glob(os.path.join(gguf_dir, "*.gguf")))
            if produced:
                # Unsloth names the file after the model; normalise so the backend
                # and the docs can rely on one predictable name.
                if not os.path.exists(canonical):
                    shutil.move(produced[0], canonical)
                print(f"[gguf] exported via Unsloth -> {canonical}")
                return canonical
            print("[gguf] Unsloth reported success but produced no .gguf")
        except Exception as exc:  # noqa: BLE001 — fall through to the manual path
            print(f"[gguf] Unsloth export failed ({exc!r})")

    print("[gguf] converting with llama.cpp from the merged weights...")
    if not os.path.isdir(merged_dir) or not os.listdir(merged_dir):
        raise SystemExit(
            f"No merged weights at {merged_dir}. Train first, or point --merged-dir "
            "at an existing merged_16bit checkpoint."
        )
    out = convert_with_llama_cpp(merged_dir, gguf_dir, quant)
    print(f"[gguf] exported via llama.cpp -> {out}")
    return out


def report_gguf(gguf_dir: str = GGUF_DIR) -> None:
    files = sorted(glob.glob(os.path.join(gguf_dir, "*.gguf")))
    for f in files:
        print(f"[gguf] {os.path.basename(f)}  {os.path.getsize(f) / 1e9:.2f} GB")
    if not files:
        print(f"[gguf] nothing in {gguf_dir}")


NEXT_STEPS = """
NEXT — serve it locally
=======================
  1. Download {gguf} from the pod
     (RunPod file browser, or: runpodctl send {gguf})
  2. Put it in the repo:      CyberSentinel/models/
  3. Install the runtime:     CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python
  4. Point the backend at it: export CTI_GGUF_PATH=./models/{name}
  5. npm run dev

backend/inference_service.py picks up CTI_GGUF_PATH automatically and reports
engine "llama.cpp ... (metal)" on /api/status.
"""


# =============================================================================
# CLI
# =============================================================================
def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="GRPO-train the CyberSentinel CTI policy on a single RTX A6000.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    g = p.add_argument_group("model")
    g.add_argument("--model", default="unsloth/Qwen3-4B-Instruct-2507",
                   help="Apache-2.0, non-thinking variant (no <think> vs <reasoning> clash)")
    g.add_argument("--lora-rank", type=int, default=16)
    g.add_argument("--max-seq-length", type=int, default=1024,
                   help="Caps vLLM's KV cache. Qwen3 advertises 262144 — leaving it "
                        "uncapped tries to allocate a KV cache for that and OOMs.")
    g.add_argument("--max-prompt-length", type=int, default=640)
    g.add_argument("--max-completion-length", type=int, default=256)

    g = p.add_argument_group("data")
    g.add_argument("--dataset", default="tumeteor/Security-TTP-Mapping")
    g.add_argument("--split", default="train")
    g.add_argument("--allow-synthetic", action="store_true",
                   help="Fall back to 8 fake rows if the download fails (plumbing test only)")
    g.add_argument("--min-rows", type=int, default=1000,
                   help="Abort if fewer rows survive filtering (guards against toy runs)")

    g = p.add_argument_group("GRPO")
    g.add_argument("--num-generations", type=int, default=4, choices=range(2, 9),
                   metavar="{2..8}", help="Group size G. 48GB VRAM comfortably allows 8")
    g.add_argument("--per-device-batch", type=int, default=None,
                   help="Defaults to --num-generations")
    g.add_argument("--grad-accum", type=int, default=4,
                   help="Prompts per optimizer step (with per_device_batch == G)")
    g.add_argument("--temperature", type=float, default=0.9,
                   help="Intra-group diversity. Too low => std(r)~0 => no gradient")
    g.add_argument("--top-p", type=float, default=0.95)
    g.add_argument("--beta", type=float, default=0.04, help="KL penalty vs the reference policy")
    g.add_argument("--learning-rate", type=float, default=5e-6)

    g = p.add_argument_group("run length")
    g.add_argument("--max-steps", type=int, default=2000)
    g.add_argument("--full-epoch", action="store_true",
                   help="Ignore --max-steps and run one full epoch (~3725 steps at "
                        "14,900 rows / 4 prompts per step)")
    g.add_argument("--save-steps", type=int, default=100)
    g.add_argument("--save-total-limit", type=int, default=3)
    g.add_argument("--logging-steps", type=int, default=1)
    g.add_argument("--seed", type=int, default=3407, help="Reproducibility")
    g.add_argument("--resume", action="store_true",
                   help="Resume from the newest checkpoint in --output-dir")

    g = p.add_argument_group("hardware")
    g.add_argument("--precision", choices=["auto", "bf16", "fp16"], default="auto",
                   help="auto picks bf16 on Ampere+ (native), fp16 otherwise")
    g.add_argument("--gpu-memory-utilization", type=float, default=None,
                   help="vLLM pool share. Default adapts to the card: 0.85 at >=40GB "
                        "(A6000), 0.70 at >=20GB (3090/4090), 0.60 below that")
    g.add_argument("--gpu", default="0", help="CUDA_VISIBLE_DEVICES value")
    g.add_argument("--no-standby", action="store_true",
                   help="Disable UNSLOTH_VLLM_STANDBY memory sharing")
    g.add_argument("--no-flashinfer", action="store_true",
                   help="Only needed on Turing; Ampere builds the kernels fine")

    g = p.add_argument_group("paths / output")
    g.add_argument("--workspace", default=WORKSPACE)
    g.add_argument("--output-dir", default=OUTPUT_DIR)
    g.add_argument("--merged-dir", default=MERGED_DIR)
    g.add_argument("--gguf-dir", default=GGUF_DIR)
    g.add_argument("--report-to", default="none", help="e.g. wandb")

    g = p.add_argument_group("stages")
    g.add_argument("--skip-gguf", action="store_true", help="Train and save, but do not quantise")
    g.add_argument("--export-only", action="store_true",
                   help="Skip training; convert existing merged weights to GGUF")
    g.add_argument("--quant", default="q4_k_m",
                   help="q4_k_m (~2.5GB) or q5_k_m (~2.9GB) if quality drops")
    g.add_argument("--skip-smoke-test", action="store_true",
                   help="Skip the reward-function assertions (not recommended)")

    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if not args.skip_smoke_test:
        run_reward_smoke_test()

    # --export-only never touches the GPU or Unsloth
    if args.export_only:
        # (no dependency check here — conversion only needs llama.cpp)
        os.makedirs(args.gguf_dir, exist_ok=True)
        path = export_gguf(quant=args.quant, merged_dir=args.merged_dir,
                           gguf_dir=args.gguf_dir)
        report_gguf(args.gguf_dir)
        print(NEXT_STEPS.format(gguf=path, name=os.path.basename(path)))
        return 0

    require_dependencies()        # actionable message before anything expensive
    configure_environment(args)   # MUST precede the unsloth import
    vram_gb = report_gpu()

    if args.gpu_memory_utilization is None:
        args.gpu_memory_utilization = auto_gpu_memory_utilization(vram_gb)
        print(f"[gpu] gpu_memory_utilization={args.gpu_memory_utilization} "
              f"(auto for {vram_gb:.0f} GB; override with --gpu-memory-utilization)")

    # Group size scales with VRAM: each extra generation is another concurrent
    # sequence in the KV cache during sampling.
    if vram_gb < 40 and args.num_generations > 4:
        print(f"[gpu] WARNING: G={args.num_generations} on a {vram_gb:.0f} GB card is "
              "likely to OOM during sampling. G=4 is the safe group size here.")

    precision = resolve_precision(args.precision)
    model, tokenizer = load_policy(args, precision)

    dataset = drop_overlong_prompts(
        build_dataset(args.dataset, args.split, args.allow_synthetic),
        tokenizer,
        args.max_prompt_length,
    )
    if len(dataset) < args.min_rows:
        raise SystemExit(
            f"Only {len(dataset)} rows survived filtering (expected ~14,900). "
            "Refusing to burn GPU-hours on a toy dataset; use --min-rows to override."
        )

    from trl import GRPOTrainer

    training_args = build_training_args(args, precision, len(dataset))
    trainer = GRPOTrainer(
        model=model,
        processing_class=tokenizer,
        reward_funcs=REWARD_FUNCS,
        args=training_args,
        train_dataset=dataset,
    )

    print("""
WHAT TO WATCH
=============
  reward_std   FIRST thing to check. Sitting at ~0 for the first few dozen steps
               means the group collapsed — all G completions are effectively
               identical, every advantage is ~0, and NOTHING is being learned.
               Raise --temperature and restart; do not let it run.
  rewards/format_reward_func       -> should climb toward 1.0 (the easy signal)
  rewards/correctness_reward_func  -> starts pinned near -1.0; lifting off that
                                      floor is the real evidence of policy search
  kl           small and stable; a spike means raise --beta
""")

    trainer.train(resume_from_checkpoint=args.resume)

    save_artifacts(model, tokenizer)

    if args.skip_gguf:
        print("[gguf] skipped (--skip-gguf); merged weights are saved for later conversion")
        return 0

    path = export_gguf(model, tokenizer, quant=args.quant,
                       merged_dir=args.merged_dir, gguf_dir=args.gguf_dir)
    report_gguf(args.gguf_dir)
    print(NEXT_STEPS.format(gguf=path, name=os.path.basename(path)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
