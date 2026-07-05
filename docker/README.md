# Camera Lab — Docker

Run Camera Lab as an isolated two-service stack. Your existing native ComfyUI is **not** touched;
this brings up its own pinned ComfyUI with the custom nodes Camera Lab needs.

## Prerequisites (one-time host setup)

- Docker + docker compose.
- NVIDIA GPU passthrough for Docker:
  - **Linux:** install `nvidia-container-toolkit`, then restart Docker.
  - **Windows:** Docker Desktop + WSL2 + a recent NVIDIA driver.
  - Verify: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
- Your ComfyUI **models** already downloaded on the host (they are mounted, not re-downloaded).

## Configure

```bash
cp docker/compose.env.example docker/compose.env
# edit docker/compose.env: set MODELS_DIR to your host models path
```

## Run

```bash
docker compose --env-file docker/compose.env up -d --build
# open http://localhost:8000  (or your CAMERA_LAB_PORT)
```

## Assess / troubleshoot

- Which modules are ready / what models are missing:
  `docker compose --env-file docker/compose.env run --rm camera-lab python scripts/check_setup.py`
- Verify all required custom nodes loaded:
  `docker compose --env-file docker/compose.env exec -T camera-lab python scripts/docker_node_smoke.py http://comfyui:8188`
- **GPU not visible:** the `comfyui` container exits with a message pointing at the toolkit/WSL2
  prerequisites above. Fix the host, then `docker compose ... up -d` again.
- **Model missing at generation time:** drop the file into your `MODELS_DIR` (no rebuild needed).

## Out of scope (v1)

- Casting / CosyVoice TTS (planned later).
- Automatic model downloading beyond models that already carry a `source_url`.
- LLM runs externally: point `LLM_URL` at your own endpoint.
