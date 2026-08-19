# syntax=docker/dockerfile:1

# CyberSentinel — single image running the whole stack:
#   Express API (:5001) -> python_bridge.js -> inference_service.py
#   and the built React SOC console served from frontend/dist.
#
# Inference engine, in preference order:
#   1. llama.cpp on a GGUF mounted at /app/models (~2.5GB, fast quantised CPU kernels)
#   2. transformers + PEFT on Qwen3-4B-Instruct-2507 + LoRA (~8GB fp16 — needs a big host)

########################################################################
# Stage 1 — build the React / Vite SOC console
########################################################################
FROM node:20-bookworm-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

########################################################################
# Stage 2 — runtime: Node API + Python inference service
########################################################################
FROM node:20-bookworm-slim AS runtime

# CPU wheels by default. For NVIDIA, build with e.g.
#   --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu129
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
ARG TORCH_VERSION=2.13.0

ENV NODE_ENV=production \
    PORT=5001 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/data/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1

# python_bridge.js spawns `python3`; PATH above resolves that to the venv.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

WORKDIR /app

# Inference dependencies. The torch wheel is ~155 MB and pip restarts it from
# byte 0 on a dropped connection, so resolve the wheel URL, fetch it with a
# resumable download into a build cache, then install from disk.
COPY requirements.txt ./
RUN --mount=type=cache,target=/wheels,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    set -eu; \
    pip install --upgrade pip; \
    pip install --dry-run --no-deps --quiet --report /tmp/torch.json \
        --index-url "${TORCH_INDEX_URL}" "torch==${TORCH_VERSION}"; \
    url="$(python3 -c "import json,sys;print(json.load(open('/tmp/torch.json'))['install'][0]['download_info']['url'])")"; \
    wheel="/wheels/$(basename "$url" | sed 's/%2B/+/')"; \
    echo "Fetching $url"; \
    curl -fL --retry 30 --retry-all-errors --retry-delay 5 --continue-at - -o "$wheel" "$url"; \
    pip install "$wheel"; \
    pip install -r requirements.txt

# Backend dependencies
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend

# Application code
COPY package.json ./
COPY backend/ ./backend/

# GRPO artifacts — inference_service.py resolves these relative to the repo root
COPY grpo_cti_tokenizer_model/ ./grpo_cti_tokenizer_model/
COPY grpo_cti_lora_adapters/ ./grpo_cti_lora_adapters/

# Built SPA — server.js serves ../frontend/dist when it exists
COPY --from=frontend /build/dist ./frontend/dist

# GGUF policy — the preferred engine. Mount or copy a *.gguf into /app/models and
# inference_service.py picks it up automatically (no HF download, ~2.5GB resident
# instead of ~8GB, and llama.cpp's quantised CPU kernels instead of PyTorch's
# missing fp16/bf16 CPU path). Created empty so a bind-mount has somewhere to land.
RUN mkdir -p /app/models

# Optional: bake the unquantised base model into the image for the transformers
# fallback engine (offline / immutable deploys).
#   docker build --build-arg PREFETCH_BASE_MODEL=true .
ARG PREFETCH_BASE_MODEL=false
ARG BASE_MODEL_ID=Qwen/Qwen3-4B-Instruct-2507
RUN if [ "$PREFETCH_BASE_MODEL" = "true" ]; then \
      python3 -c "import sys;from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1])" "${BASE_MODEL_ID}"; \
    fi

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin sentinel \
 && mkdir -p /data/huggingface \
 && chown -R sentinel:sentinel /app /data
USER sentinel

EXPOSE 5001

# Model load happens lazily in the Python child, so allow a generous start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
