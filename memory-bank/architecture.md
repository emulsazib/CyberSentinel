# Architecture

## Overview

CyberSentinel is a research/training project centered on a single Jupyter notebook that fine-tunes a quantized instruction-tuned LLM with GRPO for MITRE ATT&CK technique classification from CTI text. Trained artifacts (LoRA adapters + tokenizer) are stored alongside the notebook for reuse.

## Components

| Component | Location | Role |
| --- | --- | --- |
| Training notebook | `malware-behavior.ipynb` | End-to-end GRPO training, reward functions, dataset prep, model save |
| LoRA adapters | `grpo_cti_lora_adapters/` | PEFT LoRA weights fine-tuned on CTI → ATT&CK mapping |
| Tokenizer bundle | `grpo_cti_tokenizer_model/` | Tokenizer + chat template aligned with training |
| Governance | `memory-bank/`, `.knbase/` | knbase project memory and agent workflow |

## Data Flow

1. **Input**: CTI text snippet from `Security-TTP-Mapping` dataset (`text1` column).
2. **Prompt**: System + user messages instruct the model to reason and emit a technique ID.
3. **GRPO loop**: vLLM samples G completions per prompt; rule-based reward functions score format and correctness vs. ground-truth labels.
4. **Update**: LoRA weights adjusted via GRPOTrainer (no separate critic model).
5. **Output**: Saved LoRA adapters and tokenizer for inference or merge.

## Tech Stack

- **Base model**: `Qwen/Qwen2.5-1.5B-Instruct` (4-bit via Unsloth)
- **Training**: Unsloth FastLanguageModel, TRL GRPOTrainer (`trl==0.15.2`), PEFT LoRA
- **Inference engine**: vLLM (with FlashInfer disabled on T4)
- **Data**: Hugging Face `datasets`, `tumeteor/Security-TTP-Mapping`
- **Runtime**: Python, PyTorch fp16, Jupyter (Kaggle T4 target)

## External Dependencies

- Hugging Face Hub (model + dataset download)
- Unsloth, vLLM, transformers, peft, trl, datasets, bitsandbytes, accelerate
- Kaggle GPU environment (T4, 16GB) for primary training target
