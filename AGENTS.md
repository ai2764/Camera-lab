# Agent Notes

## Project Summary

Camera Lab is a cross-platform local web UI for driving ComfyUI video workflows. The app is a Python HTTP server that serves a static frontend and submits patched workflow prompts to a local ComfyUI instance.

## Entry Points

- Backend: `server/camera_lab_server.py`
- Frontend: `frontend/`
- Agent bootstrap: `scripts/agent_setup.py`
- Workflow install: `scripts/install_workflows.py`
- Setup check: `scripts/check_setup.py`
- Start: `scripts/start_camera_lab.py`
- Stop: `scripts/stop_camera_lab.py`
- Windows PowerShell wrappers: `scripts/*.ps1`

## Fast Agent Setup

Use this order on a fresh clone:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
python -m pytest -p no:cacheprovider tests/test_director_reference.py
```

Edit `.env` after the first command if `COMFYUI_ROOT` is still the placeholder value. `agent_setup.py` installs repo dependencies, creates `.env` from `.env.example` if it is missing, and installs bundled workflows when `COMFYUI_ROOT` points to a real ComfyUI folder. It does not install ComfyUI, models, or custom nodes.

Use `python3` instead of `python` on systems where the `python` command is not available.

For browser smoke tests, run:

```powershell
npm install
npx playwright install chromium
npm run test:e2e
```

## Local Configuration

Copy `.env.example` to `.env`.

Required environment variables:

- `COMFYUI_ROOT`: root folder of the local ComfyUI install
- `COMFYUI_URL`: ComfyUI server URL, usually `http://127.0.0.1:8000`

Do not commit `.env`.

## Repository Layout

- `server/`: Python backend and ComfyUI bridge
- `frontend/`: static browser UI
- `scripts/`: cross-platform Python helpers plus Windows PowerShell wrappers
- `workflows/app/`: checked-in workflows used directly by Camera Lab
- `workflows/experimental/`: experimental Director / IC-LoRA workflow references
- `assets/references/`: bundled reference images for examples
- `prompts/`: reusable prompt templates
- `docs/`: screenshots and research notes
- `tests/`: Python and browser smoke tests
- `tasks/`: local-only scratch space ignored by git

## External Dependencies

This repo does not vendor ComfyUI, models, or custom nodes.

If ComfyUI is not installed, stop at repo-side setup and point the user to the official install docs:

- Comfy Desktop: <https://docs.comfy.org/installation/desktop/overview>
- Manual local install: <https://docs.comfy.org/installation/manual_install>
- Source repository: <https://github.com/comfy-org/comfyui>

Do not invent local ComfyUI paths, do not vendor ComfyUI into this repo, and do not mark setup complete while `python scripts/check_setup.py` reports missing ComfyUI, models, or custom nodes. Without ComfyUI, coding agents can still inspect the repo, install repo dependencies, and run repo-only checks, but they cannot generate videos or pass the full setup check.

Expected ComfyUI layout under `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user/default/workflows`
- `custom_nodes/Comfyui_TTP_Toolset`

Required models:

- `models/checkpoints/ltx-2.3-22b-dev-fp8.safetensors`
- `models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`
- `models/loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`
- `models/latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors`

Required custom node:

- `custom_nodes/Comfyui_TTP_Toolset`

## Verification

Run:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
python -m pytest -p no:cacheprovider tests/test_director_reference.py
npm run test:e2e
```

`check_setup.py` may fail on a fresh machine until `.env`, ComfyUI, models, and custom nodes are installed.

## Commit Hygiene

Do not commit:

- `.env`
- `tasks/`
- local ComfyUI install paths
- generated videos, uploads, logs, preview renders, or prompt smoke-test output

If a file is required by users or coding agents, move it out of `tasks/` before committing it. App workflow files belong in `workflows/app/`; experimental workflow files belong in `workflows/experimental/`; small bundled images belong in `assets/references/`.

Bundled workflows are not automatically visible inside ComfyUI. Use `python scripts/install_workflows.py` to copy `workflows/app` into `COMFYUI_ROOT/user/default/workflows/camera-lab`. Add `--include-experimental` only when the experimental workflows should also be installed.

Frontend workflow dropdown mapping:

- `LTX 2.3 NAG I2V Extendcrop`: `workflows/app/ltx23_nag_i2v_extendcrop_general.json`
- `LTX 2.3 FLF TTP Control (2 images)`: built in `server/camera_lab_server.py`
- `LTX 2.3 FML (3 images, 2-stage TTP FLF)`: built in `server/camera_lab_server.py`
- `LTX 2.3 FML RuneXX Guider Local (3 images)`: `workflows/app/LTX-2.3_FML2V_RuneXX_guider.local.json`
- `LTX 2.3 IA2V`: `workflows/app/ltx23_nag_ia2v_extendcrop_general.json`
- `LTX Director Global Reference MVP`: `workflows/app/ltx_director_global_reference_mvp.json`
