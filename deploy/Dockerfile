# syntax=docker/dockerfile:1
# A fixed Linux CPU Python image plus only cuBLAS/cudart replaces the PyTorch image.
# The pinned llama CUDA binary requires GLIBC_2.38; Trixie supplies glibc 2.41.
FROM python:3.12.12-slim-trixie@sha256:42f1689d6d6b906c7e829f9d9ec38491550344ac9adc01e464ff9a08df1ffb48
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
