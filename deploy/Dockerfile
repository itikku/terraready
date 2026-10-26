# syntax=docker/dockerfile:1
# A fixed Linux CPU Python image plus only cuBLAS/cudart replaces the PyTorch image.
FROM python:3.12.12-slim-bookworm@sha256:2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/itikku/terraready"
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_NO_ENV_FILE=1 UV_CACHE_DIR=/tmp/terraready-uv-cache \
    npm_config_cache=/tmp/terraready-npm-cache \
    NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    LD_LIBRARY_PATH=/terraready/.venv/lib/python3.12/site-packages/nvidia/cublas/lib:/terraready/.venv/lib/python3.12/site-packages/nvidia/cuda_runtime/lib
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /terraready
# Build context is the reviewed source-only bundle, never the local working tree.
COPY . /terraready
RUN python3 scripts/hosted_image.py build --commit "$SOURCE_COMMIT" \
    && rm -rf /tmp/terraready-uv-cache /tmp/terraready-npm-cache /root/.cache
EXPOSE 8000
ENTRYPOINT ["python3", "-u", "scripts/hosted_image.py", "run"]
