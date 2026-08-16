# Project Memory

## Summary

CyberSentinel trains an explainable CTI → MITRE ATT&CK agent using GRPO on Qwen2.5-1.5B-Instruct. The main artifact is `malware-behavior.ipynb`; trained weights live in `grpo_cti_lora_adapters/` and `grpo_cti_tokenizer_model/`. knbase was initialized on 2026-07-17 to govern future agent work on this repo.

## Recent Changes

- **2026-08-16**: Built complete full-stack CyberSentinel CTI Chatbot Web Application:
  - **Express.js Backend**: `backend/` with `/api/chat`, `/api/analyze`, `/api/mitre`, `/api/samples`, and `/api/status`.
  - **Python Inference Bridge**: `backend/inference_service.py` with PyTorch/PEFT LoRA loading (`grpo_cti_tokenizer_model` / `grpo_cti_lora_adapters`) with MPS/CUDA/CPU auto-detection and high-precision CTI reasoning engine fallback.
  - **React.js Frontend**: `frontend/` (Vite + Vanilla CSS SOC design system) with interactive Chain-of-Thought reasoning drawer, MITRE ATT&CK card badge, MITRE Matrix Navigator, live IOC extraction and CSV export, session persistence in localStorage, and benchmark probe runner.
- **2026-07-17**: knbase initialized; governance docs bootstrapped for CyberSentinel (replacing empty scaffold templates).
- **2026-07-17**: Project-specific `.cursor/mcp.json` added with `KNBASE_ROOT` pointing to CyberSentinel.

## Learnings & Gotchas

- **Python LoRA Bridge**: On Apple Silicon Mac or headless hosts without GPU CUDA drivers, PyTorch MPS or CPU fallback enables immediate local evaluation; a JSON-RPC stdio daemon avoids re-initializing models per HTTP request.
- **CTI Policy Extraction**: The fine-tuned agent outputs `<reasoning>` and `<answer>` XML tags; separating these in the UI into an expandable thought drawer and a structured MITRE technique badge provides optimal SOC analyst UX.
- **Vite + Express Orchestration**: Running Express on port 5001 with Vite dev proxy on port 5173 enables hot-reloading in dev while serving the production bundle at `/` in standalone deployment.
- **Kaggle T4**: vLLM FlashInfer JIT fails with `/usr/bin/ld: cannot find -lcuda` — disable via `UNSLOTH_VLLM_NO_FLASHINFER=1`.
- **Security-TTP-Mapping** labels arrive as stringified Python lists; multi-label rows require exact ID match in correctness reward.

## Known Issues

- `grpo_cti_lora_adapters/README.md` is still the default Hugging Face template (needs real model card content).
- `grpo_cti_*.zip` archives present in repo root (large; should not be committed to git).
- Standalone neural inference on local Mac requires installing `torch`, `transformers`, and `peft` via pip into the Python environment if local weight execution is desired over the fallback engine.

