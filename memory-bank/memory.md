# Project Memory

## Summary

CyberSentinel trains an explainable CTI → MITRE ATT&CK agent using GRPO on Qwen2.5-1.5B-Instruct. The main artifact is `malware-behavior.ipynb`; trained weights live in `grpo_cti_lora_adapters/` and `grpo_cti_tokenizer_model/`. knbase was initialized on 2026-07-17 to govern future agent work on this repo.

## Recent Changes

- **2026-08-16**: Built and integrated **Model Reasoning Step Dashboard** (`frontend/src/components/ReasoningDashboard.jsx`, `frontend/src/utils/reasoningParser.js`):
  - Structured sequential Chain-of-Thought decomposition: Step 1 (Observation), Step 2 (Indicators), Step 3 (ATT&CK Alignment), Step 4 (Decision `<answer>`).
  - Session-level metrics: Total Reasoning Steps, Average Word Depth, 100% Policy Adherence rate, and Technique Distribution Bar Chart.
  - One-click export of full reasoning trace graphs as JSON for compliance and auditing.
  - Seamless view switcher between "Chat Session" and "Reasoning Dashboard" with live step counter badge in header and sidebar.
- **2026-08-16**: Configured dedicated Python environment (`.venv`) with PyTorch, Hugging Face `transformers`, and `peft`. Activated live neural inference for the fine-tuned GRPO LoRA weights (`grpo_cti_tokenizer_model` / `grpo_cti_lora_adapters` on `Qwen/Qwen2.5-1.5B-Instruct`) running directly on Apple Silicon GPU (`mps`) with sub-second generation.
- **2026-08-16**: Built complete full-stack CyberSentinel CTI Chatbot Web Application:
  - **Express.js Backend**: `backend/` with `/api/chat`, `/api/analyze`, `/api/mitre`, `/api/samples`, and `/api/status`.
  - **Python Inference Bridge**: `backend/inference_service.py` with direct PyTorch/PEFT LoRA loading (`grpo_cti_tokenizer_model` / `grpo_cti_lora_adapters`) with MPS/CUDA/CPU auto-detection and streaming JSON-RPC communication.
  - **React.js Frontend**: `frontend/` (Vite + Vanilla CSS SOC design system) with interactive Chain-of-Thought reasoning drawer, MITRE ATT&CK card badge, MITRE Matrix Navigator, live IOC extraction and CSV export, session persistence in localStorage, and benchmark probe runner.
- **2026-07-17**: knbase initialized; governance docs bootstrapped for CyberSentinel (replacing empty scaffold templates).
- **2026-07-17**: Project-specific `.cursor/mcp.json` added with `KNBASE_ROOT` pointing to CyberSentinel.


## Learnings & Gotchas

- **Apple Silicon MPS LoRA Acceleration**: Transferring the model to `mps` via `model.to("mps")` *after* attaching `PeftModel.from_pretrained` ensures zero device mismatches and achieves high-throughput GPU inference for Qwen2.5-1.5B in `float16`.
- **Python LoRA Bridge**: A persistent JSON-RPC stdio daemon with `PYTHONUNBUFFERED=1` keeps the model warm in GPU memory, avoiding cold-load latency across user chat messages.
- **CTI Policy Extraction**: The fine-tuned agent outputs `<reasoning>` and `<answer>` XML tags; separating these in the UI into an expandable thought drawer and a structured MITRE technique badge provides optimal SOC analyst UX.
- **Vite + Express Orchestration**: Running Express on port 5001 with Vite dev proxy on port 5173 enables hot-reloading in dev while serving the production bundle at `/` in standalone deployment.
- **Kaggle T4**: vLLM FlashInfer JIT fails with `/usr/bin/ld: cannot find -lcuda` — disable via `UNSLOTH_VLLM_NO_FLASHINFER=1`.
- **Security-TTP-Mapping** labels arrive as stringified Python lists; multi-label rows require exact ID match in correctness reward.

## Known Issues

- `grpo_cti_lora_adapters/README.md` is still the default Hugging Face template (needs real model card content).
- `grpo_cti_*.zip` archives present in repo root (large; should not be committed to git).


