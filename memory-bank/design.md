# Design

## Modules & Interfaces

### Prompt contract
- **System prompt**: Defines analyst role and exact output format (`<reasoning>` + `<answer>T####`).
- **User prompt**: `CTI snippet:\n{text}`.

### Reward functions (GRPOTrainer)
- `format_reward_func`: +1.0 if full output matches strict XML regex, else 0.0.
- `correctness_reward_func`: +2.0 if extracted ID matches any ground-truth label, else -1.0.
- `soft_format_reward_func`: partial credit for presence of tags (cold-start scaffolding).

### Dataset mapping
- `_parse_labels`: handles stringified Python lists, bare strings, and lists.
- `_to_grpo_row`: maps to conversational `prompt` + `ground_truth` columns for TRL.

## Key Decisions

| Decision | Rationale |
| --- | --- |
| GRPO over PPO | No critic model → ~half GPU memory; better for long reasoning on 16GB T4 |
| Qwen2.5-1.5B over 7B | Fits 4-bit + vLLM + LoRA + G=4 generations on T4 without OOM |
| Rule-based rewards | Deterministic, no reward model API cost; aligns with exact ATT&CK ID matching |
| `UNSLOTH_VLLM_NO_FLASHINFER=1` | Kaggle T4 linker lacks `-lcuda`; Triton sampler fallback works |
| LoRA rank 16 | Balance between capacity and memory on small GPU |
| num_generations=4 | Practical ceiling for 1.5B 4-bit on 16GB; batch size must divide evenly |

## Data Models

- **Dataset row**: `{ text1: string, labels: string | list }` → `{ prompt: Message[], ground_truth: string[] }`.
- **Completion**: `[{ role: "assistant", content: "<reasoning>…</reasoning>\n<answer>T####</answer>" }]`.
- **Technique ID regex**: `T\d{4}(?:\.\d{3})?` (supports sub-techniques e.g. T1059.001).

## Conventions

- Set `UNSLOTH_VLLM_NO_FLASHINFER` before importing Unsloth on Kaggle T4.
- Use fp16 everywhere; T4 has no bf16.
- Save adapters to `/kaggle/working/` during training; project copies in `grpo_cti_lora_adapters/`.
- Ground-truth matching is exact (T1059 ≠ T1059.001 unless listed).

## Open Questions

- Optimal training steps / epochs for convergence on full Security-TTP-Mapping split?
- Whether to remove soft_format_reward once format reward stabilizes?
- Evaluation harness for held-out test set and per-technique F1?
