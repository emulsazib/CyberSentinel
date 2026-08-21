# syntax=docker/dockerfile:1

# CyberSentinel — one image running the whole stack:
#   Express API (:5001) -> python_bridge.js -> inference_service.py
#   and the built React SOC console served from frontend/dist.
#
# The container does NOT download a model. You supply a quantised GGUF at run
# time (bind mount, see docker-compose.yml) and the service loads it with
# llama.cpp. Nothing is baked in, so swapping policies needs no rebuild.

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
# Stage 2 — compile llama-cpp-python into a wheel
########################################################################
# There are no current prebuilt linux wheels (the published CPU index stops at
# 0.2.64, which predates Qwen3 support in llama.cpp), so it must be built from
# source. Doing it here keeps cmake/g++ out of the runtime image — the compiler
# toolchain alone is ~300MB.
#
# Same base as the runtime stage on purpose: identical Debian + CPython 3.11
# means the resulting cp311 wheel is guaranteed ABI-compatible.
FROM node:20-bookworm-slim AS llama-builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-dev python3-venv build-essential cmake git \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt

# Portable build: no -march=native, since the build host and the eventual run
# host are not necessarily the same CPU.
RUN python3 -m venv /tmp/buildenv \
 && /tmp/buildenv/bin/pip install --no-cache-dir --upgrade pip wheel \
 && CMAKE_ARGS="-DGGML_NATIVE=OFF" \
    /tmp/buildenv/bin/pip wheel --no-cache-dir --wheel-dir /wheels \
      -r /tmp/requirements.txt

########################################################################
# Stage 3 — runtime: Node API + Python inference service
########################################################################
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5001 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/data/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1

# python_bridge.js spawns `python3`; PATH above resolves that to the venv.
# libgomp1 is required: llama.cpp links OpenMP, so without it importing
# llama_cpp fails with "libgomp.so.1: cannot open shared object file". The
# builder stage gets it via build-essential; this lean image must ask for it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv

WORKDIR /app

# Install the prebuilt llama-cpp-python wheel — no compiler in this image.
RUN --mount=type=bind,from=llama-builder,source=/wheels,target=/wheels \
    pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --no-index --find-links=/wheels llama-cpp-python

# Optional: the transformers + PEFT fallback engine (~2GB). Off by default —
# a GGUF deployment never touches it.
#   docker build --build-arg INSTALL_TORCH=true .
ARG INSTALL_TORCH=false
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
COPY requirements-fallback.txt ./
RUN if [ "$INSTALL_TORCH" = "true" ]; then \
      pip install --no-cache-dir --index-url "${TORCH_INDEX_URL}" torch==2.13.0 && \
      pip install --no-cache-dir -r requirements-fallback.txt; \
    else \
      echo "skipping torch stack (INSTALL_TORCH=false); GGUF engine only"; \
    fi

# Backend dependencies
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend

# Application code
COPY package.json requirements.txt ./
COPY backend/ ./backend/

# Built SPA — server.js serves ../frontend/dist when it exists
COPY --from=frontend /build/dist ./frontend/dist

# Where your GGUF gets bind-mounted. Created empty so the mount has a target and
# so a missing mount fails with our own clear message rather than a Docker error.
RUN mkdir -p /app/models

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin sentinel \
 && mkdir -p /data/huggingface \
 && chown -R sentinel:sentinel /app /data
USER sentinel

EXPOSE 5001

# The GGUF loads in seconds, so this does not need the long start period the
# transformers path required.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.js"]
