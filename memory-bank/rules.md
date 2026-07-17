# Rules & Constraints

## Must Do

- Set `UNSLOTH_VLLM_NO_FLASHINFER=1` before `import unsloth` when running on Kaggle T4.
- Use fp16 (not bf16) for T4 compatibility.
- Keep `num_generations` and `per_device_train_batch_size` divisible (TRL requirement).
- Parse labels defensively (`ast.literal_eval`, bare strings, lists).
- Update `memory-bank/memory.md` after each knbase task via `complete_task`.
- Call `start_session` before any project work when using knbase MCP.

## Must Not Do

- Do not reinstall torch on Kaggle (breaks Unsloth/vLLM compatibility).
- Do not commit `.zip` archives of model weights (`grpo_cti_*.zip`) — use Git LFS or external storage if needed.
- Do not treat partial technique matches as correct (T1059 vs T1059.001).
- Do not run knbase MCP against the wrong `KNBASE_ROOT` (must point to CyberSentinel).

## Coding Standards

- Python in notebook cells: clear section headers, inline comments for hardware-specific workarounds.
- Reward functions return `list[float]` aligned with completions batch.
- Regex patterns compiled at module level for format/correctness checks.

## Guardrails

- Large binary artifacts (`*.zip`, full merged models) stay out of git unless explicitly requested.
- No API keys or Kaggle secrets in notebook or memory-bank docs.
- OOM mitigation order: drop num_generations + batch size together → lower max_completion_length → lower gpu_memory_utilization.
