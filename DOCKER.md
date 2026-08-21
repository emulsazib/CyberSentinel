# Running CyberSentinel in Docker

One image runs the whole stack: the Express API, the Python inference service it
spawns, and the built React SOC console served from the same port.

```text
container :5001
├── node backend/server.js        API + static SPA (frontend/dist)
│   └── python_bridge.js  ──▶ python3 backend/inference_service.py
│                                └── llama.cpp on /app/models/**/*.gguf
└── /app/models                   YOUR gguf, bind-mounted read-only
```

**The image contains no weights and downloads nothing.** You bring a quantised
GGUF; the container loads it. That keeps the image small, the build reproducible,
and startup offline.

---

## Quick start (from a fresh clone)

```bash
git clone <this repo>
cd CyberSentinel

# point at the folder containing your .gguf — anywhere on disk
MODELS_DIR=~/Downloads/grpo_cti_gguf docker compose up --build -d

docker compose logs -f          # watch it load
```

Open **http://localhost:5001** — the SPA and API share that port, so there is no
Vite proxy involved.

The first build compiles llama.cpp from source (no current prebuilt linux wheels
exist), so expect several minutes. Rebuilds are cached.

If your GGUF already sits in `./models/` you can drop the variable entirely:

```bash
docker compose up --build -d
```

### Verify

```bash
curl -s localhost:5001/api/status | jq .model
```

```json
{ "engine": "gguf", "device": "cpu", "model_loaded": true,
  "gguf_path": "/app/models/cybersentinel-cti-q4_k_m.gguf" }
```

`"engine": "gguf"` means your model loaded. If `model_loaded` is `false`, the logs
print exactly what was searched and how to fix it.

```bash
curl -s localhost:5001/api/chat -H 'Content-Type: application/json' \
  -d '{"message":"The malware wrote a Run key under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run pointing to payload.exe","mode":"cti"}'
```

Stop / reset:

```bash
docker compose down
```

---

## Configuration

Compose reads these from the environment or a `.env` file beside
`docker-compose.yml` (copy `.env.example` to start):

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODELS_DIR` | `./models` | **Host folder holding your `.gguf`.** Mounted read-only at `/app/models` |
| `CTI_GGUF_PATH` | – | Exact file *inside* the container. Unset = first `*.gguf` found recursively |
| `HOST_PORT` | `5001` | Host port |
| `CTI_GPU_LAYERS` | `0` | Layers on GPU. `0` = CPU, correct for Docker on macOS (no Metal passthrough) |
| `CTI_N_CTX` | `4096` | Context window. llama.cpp errors rather than truncating an over-long prompt |
| `CTI_THREADS` | auto | Generation threads. Benchmark before overriding — see Performance |
| `CTI_TIMEOUT_MS` | `600000` | Bridge timeout for one generation. CPU responses can take minutes |
| `INSTALL_TORCH` | `false` | Build-time. `true` adds the ~2GB transformers/PEFT fallback engine |

Several `.gguf` files under `MODELS_DIR`? The first alphabetically wins and the
choice is logged; set `CTI_GGUF_PATH` to be explicit.

---

## Host requirements

| Resource | Needed |
| --- | --- |
| RAM for Docker | **4 GB** (a 4B Q4_K_M model is ~2.5 GB resident) |
| Disk | ~700 MB image + your GGUF |
| Network | build only — running is fully offline |

---

## Performance

All measured on an Apple M1 (8 cores), 4B Q4_K_M policy, full
`<reasoning>`+`<answer>` responses:

| Engine | Weights | Per response | Why |
| --- | --- | --- | --- |
| **llama.cpp, Metal** (native `npm run dev`) | ~2.5 GB | **~13 s** (16.3 tok/s) | quantised kernels + GPU offload |
| **llama.cpp, CPU (this container)** | ~2.5 GB | **~289 s** (~1.7 tok/s) | Docker on macOS has no Metal passthrough |
| PyTorch `float16` CPU | ~8 GB | ~28 min* | no fp16 CPU kernel; every matmul round-trips through fp32 |
| PyTorch `float32` CPU | ~16 GB | — | weights do not fit on a small host |

\* measured in-container on the earlier 1.5B policy; a 4B model is proportionally worse.

**Read the second row before deploying on a Mac.** A containerised response takes
about five minutes, roughly 20x slower than the same model natively on Metal. It
works and returns correct answers — the `CTI_TIMEOUT_MS` default of 600 s exists
for exactly this — but it is not a comfortable interactive experience.

- **On a Mac:** use `npm run dev` for day-to-day use. Docker here is for testing
  that the deployment itself works.
- **On a Linux server:** no VM layer, so expect meaningfully better than the 289 s
  above, though still far short of GPU speed.
- **For GPU:** build llama-cpp-python with CUDA and set `CTI_GPU_LAYERS=-1` (see
  Variants below).

Thread count is auto-selected. `CTI_THREADS` can override it, but measured here 4
threads was *slower* than the default 8 (358 s vs 289 s) — benchmark before
changing it rather than assuming fewer/more is better.

**One model instance per machine.** Two resident copies (a benchmark script
alongside the running server, say) can exceed available memory on an 8 GB host and
fail with `RuntimeError: llama_decode returned -3`.

---

## Variants

**NVIDIA GPU** — build llama-cpp-python with CUDA and give the container a GPU.
Edit the `llama-builder` stage to pass `CMAKE_ARGS="-DGGML_CUDA=on"`, then:

```yaml
    gpus: all
    environment:
      CTI_GPU_LAYERS: -1     # offload every layer
```

**Unquantised fallback engine** (base model + LoRA adapters, CUDA hosts):

```bash
INSTALL_TORCH=true docker compose build
```

Adds ~2GB and downloads an ~8GB base model at first run. Not recommended on CPU.

**Plain docker, no compose:**

```bash
docker build -t cybersentinel:1.0.0 .
docker run -d --name cybersentinel -p 5001:5001 \
  -v ~/Downloads/grpo_cti_gguf:/app/models:ro \
  cybersentinel:1.0.0
```

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `NO MODEL AVAILABLE` banner in the logs | No `.gguf` found. Check `MODELS_DIR` points at the folder *containing* the file, and that the file ends in `.gguf` |
| `model_loaded: false` | Same as above — the logs list exactly what path was searched |
| `bind: address already in use` | Something owns the port (often a native `node backend/server.js`). Use `HOST_PORT=5002` |
| `Inference request timeout` | CPU generation is slower than the timeout; raise `CTI_TIMEOUT_MS` **and** restart to clear the queued backlog |
| `llama_decode returned -3` | Out of memory, often two model instances. Give Docker more RAM or stop the other one |
| Requests hang after one timeout | Backlogged Python queue; restart the container |
| `no space left on device` while building | Docker's VM disk is full — raise the limit under Settings → Resources, or `docker builder prune` |
| Build fails compiling llama.cpp | Ensure Docker has ≥4 GB RAM; the compile is memory-hungry |

Python-side logs are prefixed `[Python]` / `[CyberSentinel]`; the bridge logs as
`[Bridge]`.
