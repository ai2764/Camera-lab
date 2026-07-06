#!/usr/bin/env bash
set -euo pipefail

echo "[comfyui] GPU preflight..."
if ! python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"; then
  cat >&2 <<'MSG'
[comfyui] ERROR: no CUDA GPU visible inside the container.
  The comfyui service needs GPU passthrough. Check host prerequisites:
    - Linux:   install nvidia-container-toolkit and restart docker
    - Windows: Docker Desktop + WSL2 + a recent NVIDIA driver
  Verify with:  docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
MSG
  exit 1
fi
echo "[comfyui] GPU OK: $(python -c 'import torch; print(torch.cuda.get_device_name(0))')"

exec python main.py --listen 0.0.0.0 --port 8188 "$@"
