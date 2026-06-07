# Camera Lab

Camera Lab is a small local web UI for testing camera movement prompts and ComfyUI video workflows.

It runs as a Python HTTP server and talks to a local ComfyUI instance.

![Camera Lab interface](docs/images/camera-lab-home.png)

## Quick Start

### 1. Requirements

- Windows
- Python 3.10 or newer
- PowerShell
- A working local ComfyUI install

Start ComfyUI first. Camera Lab expects ComfyUI to be reachable at:

```text
http://127.0.0.1:8000
```

### 2. Create Local Config

Copy the example config:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your own ComfyUI folder:

```text
COMFYUI_ROOT=C:\ComfyUI
COMFYUI_URL=http://127.0.0.1:8000
```

Do not commit `.env`. It is ignored by git because it is machine-specific.

### 3. Install Python Dependency

```powershell
python -m pip install -r requirements.txt
```

### 4. Check Setup

Run:

```powershell
.\scripts\check_setup.ps1
```

If a check says `MISSING`, fix that item before starting Camera Lab. The most common issues are:

- `.env` was not created
- `COMFYUI_ROOT` points to the wrong folder
- ComfyUI is not running
- Required LTX models are missing
- Required custom nodes or workflow files are missing

### 5. Start Camera Lab

```powershell
.\scripts\start_camera_lab.ps1 -Open
```

Default URL:

```text
http://127.0.0.1:1234
```

Use another port if needed:

```powershell
.\scripts\start_camera_lab.ps1 -p 9000 -Open
```

### 6. Stop Camera Lab

```powershell
.\scripts\stop_camera_lab.ps1
```

Use a custom port if you started one:

```powershell
.\scripts\stop_camera_lab.ps1 -p 9000
```

## If PowerShell Blocks Scripts

Run this once for your Windows user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

You can also start the server directly:

```powershell
python tools\camera_lab_server.py --port 1234
```

Then open:

```text
http://127.0.0.1:1234
```

## Browser E2E Tests

Camera Lab uses Playwright for browser-level smoke tests of the web UI.

Install Node dependencies and the Chromium test browser:

```powershell
npm install
npx playwright install chromium
```

Run the E2E suite:

```powershell
npm run test:e2e
```

The current E2E test opens the Photography workspace, verifies the 3D canvas, adds a camera keyframe, changes easing, bakes a Canny preview, and mocks the frame upload endpoint.

## Expected ComfyUI Layout

Camera Lab reads these paths from `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user\default\workflows`
- `.venv\Lib\site-packages\comfyui_workflow_templates_media_video\templates`
- `custom_nodes\Comfyui_TTP_Toolset`

The setup checker verifies the important paths and files.

## Included

- `tools/camera_lab_server.py`: local backend and ComfyUI bridge
- `tools/camera_lab_web/`: frontend
- `scripts/start_camera_lab.ps1`: Windows startup script
- `scripts/stop_camera_lab.ps1`: Windows stop script
- `scripts/check_setup.ps1`: setup checker for new users
- `.env.example`: local config template
- `AGENTS.md`: quick dependency and workflow notes for coding agents
- `dependency-manifest.json`: machine-readable dependency manifest
- `tasks/camera_lab_workflows/downloaded/`: workflow references used by Camera Lab
- `docs/research/`: camera-control notes, testing plan, and results page

## Repository Folders

- `tools/`: Camera Lab server and web UI source.
- `scripts/`: setup, start, and stop helpers for Windows users.
- `tests/`: Python tests for workflow patching and Director reference behavior.
- `docs/`: screenshots, research notes, and user-facing documentation.
- `prompts/`: reusable prompt/reference text.
- `tasks/`: mostly local experiments and workflow reference material.

The `tasks` folder is not a general runtime dependency folder. Most generated test outputs under `tasks` are ignored by git and can be recreated. The important checked-in pieces are:

- `tasks/camera_lab_workflows/downloaded/`: ComfyUI workflow references that Camera Lab or workflow experiments are based on.
- `tasks/camera_lab_workflows/experimental/`: experimental Director / IC-LoRA workflow references.
- `tasks/LTX_camera_prompt_suite_xiaomei/references/`: small reference images used by the built-in prompt examples.
- `tasks/LTX 去字幕/`: a small checked-in reference asset from an earlier workflow test.

Runtime/test leftovers such as `tasks/camera_lab_runs/`, `tasks/camera_lab_uploads/`, `tasks/fututek_*`, `tasks/ic_lora_*`, `tasks/photography_ltx_*`, generated previews, logs, uploaded media, and rendered videos should not be committed.

## Runtime Data

Generated runs and uploaded files are written under:

- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`

Those folders are ignored by git.
