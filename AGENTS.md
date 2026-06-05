# Agent Notes

## Project

Camera Lab is a local Python HTTP server plus a static web UI for driving ComfyUI video workflows.

## Runtime

- OS: Windows
- Python: 3.10+
- Main entry: `tools/camera_lab_server.py`
- Start script: `scripts/start_camera_lab.ps1`
- Stop script: `scripts/stop_camera_lab.ps1`
- Setup check: `scripts/check_setup.ps1`

## Required Local Config

Copy `.env.example` to `.env`.

Required environment variables:

- `COMFYUI_ROOT`: root folder of the local ComfyUI install
- `COMFYUI_URL`: ComfyUI server URL, usually `http://127.0.0.1:8000`

Do not commit `.env`.

## Python Dependencies

Install with:

```powershell
python -m pip install -r requirements.txt
```

Current direct dependency:

- Pillow

## External Dependencies

This repo does not vendor ComfyUI, models, or custom nodes.

Expected ComfyUI layout under `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user\default\workflows`
- `.venv\Lib\site-packages\comfyui_workflow_templates_media_video\templates`
- `custom_nodes\Comfyui_TTP_Toolset`

## Required Models

- `models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors`
- `models\text_encoders\gemma_3_12B_it_fp4_mixed.safetensors`
- `models\loras\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`
- `models\latent_upscale_models\ltx-2.3-spatial-upscaler-x2-1.1.safetensors`

## Required Custom Nodes

- `custom_nodes\Comfyui_TTP_Toolset`

## Verification

Run:

```powershell
.\scripts\check_setup.ps1
python -m pytest -p no:cacheprovider tests/test_director_reference.py
```

`check_setup.ps1` may fail on a fresh machine until `.env`, ComfyUI, models, and custom nodes are installed.

## Do Not Commit

- `.env`
- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`
- local ComfyUI install paths
- generated videos and uploaded media

