# Phases & Roadmap

## Current Phase

**Artifacts & documentation** — core GRPO training pipeline implemented in notebook; LoRA adapters and tokenizer exported to repo. knbase initialized for ongoing agent-guided development.

## Completed

- [x] GRPO training notebook with Unsloth + vLLM + TRL
- [x] Reward functions (format, correctness, soft format)
- [x] Security-TTP-Mapping dataset integration with label parsing
- [x] Trained LoRA adapters saved (`grpo_cti_lora_adapters/`)
- [x] Tokenizer bundle saved (`grpo_cti_tokenizer_model/`)
- [x] knbase governance initialized

## In Progress

- [ ] knbase bootstrap and project memory authoring

## Next Up

1. Add inference/evaluation cell loading saved LoRA adapters on sample CTI snippets.
2. Fill in model card (`grpo_cti_lora_adapters/README.md`) with training details and usage.
3. Run held-out evaluation metrics (accuracy, format compliance).

## Backlog

- Merge LoRA into full 16-bit model for standalone deployment
- Expand to multi-label technique prediction
- Hugging Face Hub upload of fine-tuned adapters
- Git init and CI for notebook smoke tests
