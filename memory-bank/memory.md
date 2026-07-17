# Project Memory

## Summary

CyberSentinel trains an explainable CTI → MITRE ATT&CK agent using GRPO on Qwen2.5-1.5B-Instruct. The main artifact is `malware-behavior.ipynb`; trained weights live in `grpo_cti_lora_adapters/` and `grpo_cti_tokenizer_model/`. knbase was initialized on 2026-07-17 to govern future agent work on this repo.

## Recent Changes

- **2026-07-17**: knbase initialized; governance docs bootstrapped for CyberSentinel (replacing empty scaffold templates).
- **2026-07-17**: Project-specific `.cursor/mcp.json` added with `KNBASE_ROOT` pointing to CyberSentinel.

## Learnings & Gotchas

- Kaggle T4: vLLM FlashInfer JIT fails with `/usr/bin/ld: cannot find -lcuda` — disable via `UNSLOTH_VLLM_NO_FLASHINFER=1`.
- Global knbase MCP config (`~/.cursor/mcp.json`) was pointing at portfolio project; per-project `.cursor/mcp.json` overrides for this workspace.
- `Security-TTP-Mapping` labels arrive as stringified Python lists; multi-label rows require exact ID match in correctness reward.
- TRL GRPO requires batch size divisible by `num_generations`.

## Known Issues

- `grpo_cti_lora_adapters/README.md` is still the default Hugging Face template (needs real model card content).
- `grpo_cti_*.zip` archives present in repo root (large; should not be committed to git).
- No git repository initialized yet in CyberSentinel.
- No automated evaluation script outside the notebook.
