# Camera Lab

Camera Lab is a small local web UI for testing camera movement prompts and ComfyUI workflows.

It runs as a Python HTTP server and talks to a local ComfyUI instance.

## Start

1. Start ComfyUI first.
2. Install the Python dependency if needed:

```powershell
python -m pip install -r requirements.txt
```

3. Start Camera Lab:

```powershell
.\scripts\start_camera_lab.ps1 -Open
```

Use a custom port if needed:

```powershell
.\scripts\start_camera_lab.ps1 -p 9000 -Open
```

Default URLs:

- Camera Lab: `http://127.0.0.1:1234`
- ComfyUI: `http://127.0.0.1:8000`

## Expected Local ComfyUI Paths

The current server is configured for this local ComfyUI install:

```text
C:\Users\AIBOX\Desktop\GEN-ART\ComfyUI
```

Important paths used by the app:

- Comfy input: `ComfyUI\input`
- Comfy output: `ComfyUI\output`
- Comfy models: `ComfyUI\models`
- Official workflow templates: `ComfyUI\.venv\Lib\site-packages\comfyui_workflow_templates_media_video\templates`
- User workflows: `ComfyUI\user\default\workflows`
- TTP custom node: `ComfyUI\custom_nodes\Comfyui_TTP_Toolset`

## Included

- `tools/camera_lab_server.py`: local backend and ComfyUI bridge.
- `tools/camera_lab_web/`: frontend.
- `scripts/start_camera_lab.ps1`: Windows startup script.
- `tasks/camera_lab_workflows/downloaded/`: downloaded workflow references used by Camera Lab.
- `tasks/LTX_camera_prompt_suite_xiaomei/references/`: bundled starter images.
- `docs/research/`: camera-control notes, testing plan, results page, and voiceover draft.

## Runtime Data

Generated runs and uploaded files are written under:

- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`

Those folders are ignored by git.
