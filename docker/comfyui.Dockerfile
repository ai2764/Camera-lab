# syntax=docker/dockerfile:1
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ARG COMFYUI_COMMIT=2f4c4e983c63dc60ae781bcca01e0e17f4f404d6
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu124
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates gnupg curl git \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3.12-dev \
      ffmpeg libgl1 libglib2.0-0 \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/comfyanonymous/ComfyUI.git ComfyUI \
    && git -C ComfyUI checkout ${COMFYUI_COMMIT}
WORKDIR /opt/ComfyUI

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir torch torchvision torchaudio --index-url ${TORCH_INDEX} \
    && python -m pip install --no-cache-dir -r requirements.txt

# Bundle pinned custom nodes from nodes.lock, installing each node's requirements.
# Use bash for this RUN so ANSI-C quoting ($'\t') is a real tab (default /bin/sh
# is dash, which treats $'\t' as the literal string "$\t" and breaks the parse).
COPY docker/nodes.lock /tmp/nodes.lock
SHELL ["/bin/bash", "-c"]
RUN set -euxo pipefail; \
    while IFS=$'\t' read -r dir repo commit; do \
      case "$dir" in ''|\#*) continue;; esac; \
      git clone "$repo" "custom_nodes/$dir"; \
      git -C "custom_nodes/$dir" checkout "$commit"; \
      if [ -f "custom_nodes/$dir/requirements.txt" ]; then \
        python -m pip install --no-cache-dir -r "custom_nodes/$dir/requirements.txt"; \
      fi; \
    done < /tmp/nodes.lock

# workflow_compat_nodes (GetNode/SetNode) is vendored in this repo at a known path.
COPY custom_nodes/workflow_compat_nodes /opt/ComfyUI/custom_nodes/workflow_compat_nodes

COPY docker/entrypoint-comfyui.sh /usr/local/bin/entrypoint-comfyui.sh
RUN chmod +x /usr/local/bin/entrypoint-comfyui.sh
EXPOSE 8188
ENTRYPOINT ["/usr/local/bin/entrypoint-comfyui.sh"]
