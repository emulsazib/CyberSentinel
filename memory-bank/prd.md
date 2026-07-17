# Product Requirements (PRD)

## Problem

Security analysts spend significant time manually mapping unstructured cyber threat intelligence (CTI) text to MITRE ATT&CK techniques. Existing LLMs can guess technique IDs but often lack structured, auditable reasoning and reliable output formatting for downstream automation.

## Goals

- Train a small language model (Qwen2.5-1.5B-Instruct) to read CTI snippets and output the most relevant MITRE ATT&CK technique ID.
- Produce explainable outputs with step-by-step reasoning in `<reasoning>` tags and the technique ID in `<answer>` tags.
- Use GRPO (Group Relative Policy Optimization) with rule-based rewards so training fits a single 16GB GPU (Kaggle T4).
- Ship reusable LoRA adapters and tokenizer artifacts for inference and further fine-tuning.

## Users & Personas

- **SOC analyst**: needs quick, explainable ATT&CK mapping from raw CTI reports.
- **Threat intel researcher**: evaluates model accuracy on Security-TTP-Mapping-style datasets.
- **ML engineer**: retrains or extends the GRPO pipeline on Kaggle/local GPU hardware.

## Functional Requirements

1. Load Qwen2.5-1.5B-Instruct in 4-bit via Unsloth with vLLM fast inference.
2. Fine-tune LoRA adapters using GRPOTrainer on `tumeteor/Security-TTP-Mapping` (CTI text → technique labels).
3. Reward functions: strict XML format (+1), correct technique ID (+2 / -1), optional soft format scaffolding.
4. Save trained LoRA adapters and tokenizer to disk (`grpo_cti_lora_adapters/`, `grpo_cti_tokenizer_model/`).
5. Notebook (`malware-behavior.ipynb`) documents the full training pipeline for Kaggle T4.

## Non-Goals

- Production deployment API or real-time CTI ingestion pipeline.
- Multi-label ranking of all possible techniques (single best technique per snippet).
- Training on hardware without fp16 support or below ~16GB VRAM without further downsizing.

## Success Metrics

- Model consistently emits valid `<reasoning>…</reasoning><answer>T####</answer>` format.
- Correctness reward improves over GRPO training steps on held-out CTI snippets.
- LoRA adapters load and generate inference outputs with the saved tokenizer.
- Notebook runs end-to-end on Kaggle T4 without OOM at default hyperparameters.
