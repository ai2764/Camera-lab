# Agent Notes

## Project Summary

Camera Lab is a Windows-first local web UI for driving ComfyUI video workflows. The app is a Python HTTP server that serves a static frontend and submits patched workflow prompts to a local ComfyUI instance.

## Entry Points

- Backend: `server/camera_lab_server.py`
- Frontend: `frontend/`
- Start: `scripts/start_camera_lab.ps1`
- Stop: `scripts/stop_camera_lab.ps1`
- Setup check: `scripts/check_setup.ps1`

## Local Configuration

Copy `.env.example` to `.env`.

Required environment variables:

- `COMFYUI_ROOT`: root folder of the local ComfyUI install
- `COMFYUI_URL`: ComfyUI server URL, usually `http://127.0.0.1:8000`

Do not commit `.env`.

## Repository Layout

- `server/`: Python backend and ComfyUI bridge
- `frontend/`: static browser UI
- `scripts/`: Windows setup/start/stop helpers
- `workflows/app/`: checked-in workflows used directly by Camera Lab
- `workflows/experimental/`: experimental Director / IC-LoRA workflow references
- `assets/references/`: bundled reference images for examples
- `prompts/`: reusable prompt templates
- `docs/`: screenshots and research notes
- `tests/`: Python and browser smoke tests
- `tasks/`: local-only scratch space ignored by git

## External Dependencies

This repo does not vendor ComfyUI, models, or custom nodes.

Expected ComfyUI layout under `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user\default\workflows`
- `.venv\Lib\site-packages\comfyui_workflow_templates_media_video\templates`
- `custom_nodes\Comfyui_TTP_Toolset`

Required models:

- `models\checkpoints\ltx-2.3-22b-dev-fp8.safetensors`
- `models\text_encoders\gemma_3_12B_it_fp4_mixed.safetensors`
- `models\loras\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`
- `models\latent_upscale_models\ltx-2.3-spatial-upscaler-x2-1.1.safetensors`

Required custom node:

- `custom_nodes\Comfyui_TTP_Toolset`

## Verification

Run:

```powershell
.\scripts\check_setup.ps1
python -m pytest -p no:cacheprovider tests/test_director_reference.py
npm run test:e2e
```

`check_setup.ps1` may fail on a fresh machine until `.env`, ComfyUI, models, and custom nodes are installed.

## Commit Hygiene

Do not commit:

- `.env`
- `tasks/`
- local ComfyUI install paths
- generated videos, uploads, logs, preview renders, or prompt smoke-test output

If a file is required by users or coding agents, move it out of `tasks/` before committing it. App-used workflow files belong in `workflows/app/`; experimental workflow files belong in `workflows/experimental/`; small bundled images belong in `assets/references/`.
