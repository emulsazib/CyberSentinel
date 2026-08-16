# Phases & Roadmap

## Current Phase

**Web Application & Evaluation** — Full-stack CTI Chatbot with Express.js backend and React.js frontend built and verified. Connected to LoRA model directory artifacts with real-time inference and MITRE ATT&CK exploration.

## Completed

- [x] GRPO training notebook with Unsloth + vLLM + TRL
- [x] Reward functions (format, correctness, soft format)
- [x] Security-TTP-Mapping dataset integration with label parsing
- [x] Trained LoRA adapters saved (`grpo_cti_lora_adapters/`)
- [x] Tokenizer bundle saved (`grpo_cti_tokenizer_model/`)
- [x] knbase governance initialized
- [x] Standalone evaluation script (`evaluate_cti_agent.py`)
- [x] Express.js backend API with Python LoRA inference bridge (`backend/`)
- [x] React.js + Vite frontend with MITRE Matrix Navigator, Chain-of-Thought drawer, and IOC extractor (`frontend/`)
- [x] Root orchestration npm scripts for unified dev/prod runs


## Backlog

- Merge LoRA into full 16-bit model for standalone deployment
- Expand to multi-label technique prediction
- Hugging Face Hub upload of fine-tuned adapters
- Git init and CI for notebook smoke tests
