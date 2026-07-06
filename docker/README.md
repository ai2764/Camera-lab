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

## Launcher (recommended entry point)

Instead of picking a compose file by hand, run the launcher on the host. The full
beginner walkthrough is in the main [README](../README.md#beginner-installation-guide).
The launcher detects your GPU/VRAM, tells you which modules are feasible and what
your ComfyUI is missing, then starts the right mode:

```bash
python scripts/launch.py
python scripts/launch.py --assess-only
python scripts/launch.py --dry-run --mode full-docker
python scripts/launch.py --mode full-docker
```

Modes:

- `no-docker` - native camera-lab against your existing ComfyUI.
- `full-docker` - ComfyUI + camera-lab, both in containers.
- `comfy-only-docker` - ComfyUI in a container, camera-lab native.
- `cam-lab-only-docker` - camera-lab in a container against your existing ComfyUI
  (that ComfyUI must listen on `0.0.0.0`, via `--listen`).

The launcher only recommends models (which quant fits your VRAM, what is
missing); it never downloads them.
