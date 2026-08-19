# Running CyberSentinel in Docker

One image runs the whole stack: the Express API, the Python inference service it
spawns, and the built React SOC console served from the same port.

```text
container :5001
├── node backend/server.js        API + static SPA (frontend/dist)
│   └── python_bridge.js  ──▶ python3 backend/inference_service.py   (JSON-RPC over stdin/stdout)
│                                ├── 1. llama.cpp on /app/models/*.gguf   ← preferred
│                                └── 2. Qwen3-4B-Instruct-2507 + GRPO LoRA (fallback)
├── /app/models                   your .gguf, bind-mounted read-only
└── /data/huggingface             base-model cache (named volume `hf-cache`)
```

**Put a GGUF in `./models/` before starting.** It is the engine that makes this
container practical: a Q4_K_M 4B policy is ~2.5 GB and uses llama.cpp's quantised
CPU kernels, versus ~8 GB and unusable throughput for the PyTorch fallback (see
the benchmark below). Build one with the last cell of `malware-behavior.ipynb`.

The GRPO adapters (`grpo_cti_tokenizer_model/`, `grpo_cti_lora_adapters/`) are
baked into the image for the fallback engine. The base model is **not** — it is
downloaded on first start and cached in the `hf-cache` volume. With a GGUF
present, no download happens at all.

---

## Quick start

```bash
mkdir -p models
cp ~/Downloads/cybersentinel-cti-q4_k_m.gguf models/

docker compose up --build -d
docker compose logs -f          # watch the model load
```

Open **http://localhost:5001** — the SPA and the API share that port, so no
Vite proxy is involved.

```bash
curl -s localhost:5001/health
curl -s localhost:5001/api/status | jq .model
curl -s localhost:5001/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"The malware wrote a Run key under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run pointing to payload.exe","mode":"cti"}'
```

`/api/status` reports which engine won:

```json
{ "engine": "gguf", "device": "cpu", "model_loaded": true,
  "gguf_path": "/app/models/cybersentinel-cti-q4_k_m.gguf" }
```

`"engine": "gguf"` means llama.cpp loaded your quantised file (a few seconds).
`"engine": "transformers"` means no GGUF was found and it fell back to
downloading the full base model — check that `./models/` actually contains a
`.gguf` if you did not intend that.

Stop / reset:

```bash
docker compose down             # keeps the model cache
docker compose down -v          # also deletes the cache (next start re-downloads)
```

---

## Host requirements

| Resource | With a GGUF (recommended) | PyTorch fallback |
| --- | --- | --- |
| RAM given to Docker | **4 GB** | 16+ GB (4B fp32 weights alone are ~16 GB) |
| Disk | ~2.3 GB image + ~2.5 GB GGUF | + ~8 GB base-model cache |
| Network | **none** — the GGUF is local | downloads the base model on first start |

The GGUF engine is what brings this back within reach of an ordinary laptop.
The PyTorch fallback exists for GPU hosts; do not try to run it on a small
CPU-only machine.

On Docker Desktop, raise memory under **Settings → Resources → Memory**. Too
little memory shows up as the Python child being killed and restarted every few
seconds in `docker compose logs` (exit code 137, `OOMKilled: true`).

---

## Use the GGUF engine — do not run PyTorch on CPU

The container prefers **llama.cpp on a quantised GGUF**, and on any CPU-only host
that is the only sane choice.

The PyTorch rows below were measured in this container on an Apple Silicon host
(8 CPU threads, 38-token prompt) against the earlier 1.5B policy. **The llama.cpp
row is not yet measured here** — benchmark it once your GGUF exists and replace
the estimate:

| Engine / `CTI_DTYPE` | Weights (4B) | Per token | 256-token reply | Why |
| --- | --- | --- | --- | --- |
| **llama.cpp Q4_K_M** | **~2.5 GB** | *not yet measured* | *not yet measured* | purpose-built quantised CPU kernels; expected to be orders of magnitude faster than the rows below |
| PyTorch `float32` | ~16 GB | — | — | oneDNN fp32 path is fine, but the weights do not fit |
| PyTorch `float16` | ~8 GB | 6.5 s* | ~28 min* | no fp16 CPU kernel; every matmul round-trips through fp32 |
| PyTorch `bfloat16` | ~8 GB | slower still* | — | `mkldnn_matmul bf16 path needs a cpu with bf16 support` → BLAS fallback |

\* measured on the 1.5B policy; a 4B model is proportionally worse.

The halved-memory PyTorch dtypes look attractive and are a trap — they fit more
easily but are one to two orders of magnitude slower, and under memory pressure
fp32 degraded to 122 s per token. Quantising properly (GGUF) targets both
problems at once: less memory *and* faster kernels.

Put your `.gguf` in `./models/` and compose mounts it read-only at `/app/models`,
where `inference_service.py` finds it automatically. Nothing is baked into the
image, so swapping policies needs no rebuild.

**On macOS specifically:** containers run in a Linux VM with no Metal
passthrough, so `CTI_GPU_LAYERS=0` (the compose default) is correct here — the
GGUF runs on CPU. Natively via `npm run dev` the same file uses Metal instead;
install `llama-cpp-python` with `CMAKE_ARGS="-DGGML_METAL=on"` and leave
`CTI_GPU_LAYERS=-1`.

---

## Configuration

Compose reads these from the environment or a `.env` file next to
`docker-compose.yml`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST_PORT` | `5001` | Host port mapped to the container's 5001 |
| `CTI_GGUF_PATH` | – | Explicit GGUF file. Unset = first `*.gguf` in `/app/models` |
| `CTI_GPU_LAYERS` | `0` in Docker, `-1` native | Layers offloaded to GPU. `-1` = all (Metal); `0` = pure CPU |
| `CTI_N_CTX` | `2048` | llama.cpp context window (prompt 640 + completion 256 fits easily) |
| `CTI_DTYPE` | `auto` | **Fallback engine only.** float32 on CPU, float16 on CUDA |
| `CTI_TIMEOUT_MS` | `120000` | Bridge timeout for one generation. Raise on slow CPU hosts |
| `HF_TOKEN` | – | Only needed for gated/private Hugging Face repos |
| `TORCH_INDEX_URL` | CPU wheel index | Build-time; switch for a CUDA build |

A timed-out request is **not** cancelled — Python keeps generating and the next
request queues behind it, so a too-short timeout turns into a stuck queue.
Restart the container to clear a backlog.

Example `.env`:

```dotenv
HOST_PORT=8080
CTI_TIMEOUT_MS=300000
```

---

## Variants

**Offline / immutable image** — bake the base model in at build time (adds ~3 GB
to the image, removes the runtime download):

```bash
docker compose build --build-arg PREFETCH_BASE_MODEL=true
```

**NVIDIA GPU** — build against a CUDA wheel index and hand the container a GPU.
Check <https://pytorch.org/get-started/locally/> for the tag matching your driver:

```bash
TORCH_INDEX_URL=https://download.pytorch.org/whl/cu129 docker compose build
```

then add to the service in `docker-compose.yml`:

```yaml
    gpus: all
    environment:
      CTI_DTYPE: float16
```

The service auto-selects CUDA when `torch.cuda.is_available()`.

> Apple Silicon MPS is **not** reachable from Docker — containers on macOS run in
> a Linux VM with no Metal passthrough. On a Mac the container is CPU-only; use
> the native `npm run dev` path if you want MPS acceleration.

**Plain docker, no compose:**

```bash
docker build -t cybersentinel:1.0.0 .
docker run -d --name cybersentinel -p 5001:5001 \
  -e CTI_DTYPE=bfloat16 \
  -v cybersentinel-hf:/data/huggingface \
  cybersentinel:1.0.0
```

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `engine: "transformers"` when you expected `"gguf"` | No `.gguf` found. Check `./models/` is non-empty and mounted, or set `CTI_GGUF_PATH` |
| `Warning: GGUF load exception (No module named 'llama_cpp')` | `llama-cpp-python` missing from the image — rebuild after the `requirements.txt` change |
| `Python process exited with code 137`, repeating | Out of memory — almost always the PyTorch fallback engine. Supply a GGUF instead of raising the memory limit |
| `bind: address already in use` on `up` | Something already owns the port (often a native `node backend/server.js`). Start with `HOST_PORT=5002 docker compose up -d` |
| `no space left on device` while exporting layers | Docker's VM disk is full — raise the disk limit under Settings → Resources, or `docker builder prune` |
| `/api/status` stuck at `model_loaded: false` | Still downloading; follow `docker compose logs -f` |
| `Inference request timeout (120s)` | Generation is slower than the timeout. Raise `CTI_TIMEOUT_MS` **and** restart to clear the queued backlog |
| Container exits with code 143, or Docker Desktop quits | SIGTERM from the host — Docker's VM is starved. Lower the VM's memory or move to a bigger host |
| Requests hang after one timeout | Backlogged Python queue; restart the container |
| Build fails resolving `torch==2.13.0` | That version is missing from the chosen wheel index — set `--build-arg TORCH_VERSION=<available>` |
| SPA loads but `/api/*` 404s | `frontend/dist` missing from the image — rebuild without `--target frontend` |

Logs for the Python side are prefixed `[Python]` / `[CyberSentinel]`; the bridge
logs as `[Bridge]`.
