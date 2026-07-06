# Architecture

Camera Lab is a local web workspace for building ComfyUI-powered AI video shots.
It runs as a lightweight Python HTTP server, serves a static frontend, stages
media locally, patches workflow prompts, submits them to ComfyUI, polls results,
and records run history.

## System Architecture

```mermaid
flowchart TB
  USER["User in browser"]
  UI["Static frontend<br/>Camera Lab / Director / Edit / Motion / Casting"]
  SERVER["Python HTTP server<br/>media staging, validation, prompt patching, polling"]
  RUNS["Local run state<br/>tasks/, uploads, outputs, history"]

  subgraph Workflows["Workflow layer"]
    LTX["LTX shot and Director workflows"]
    WAN["WAN Bernini and VACE Inpaint workflows"]
    MOTION["HY-Motion and SCAIL2 workflows"]
    CAST["Casting analysis and TTS jobs"]
  end

  subgraph Comfy["Local generation services"]
    COMFY_MAIN["ComfyUI main instance<br/>COMFYUI_URL"]
    COMFY_MOTION["Optional motion ComfyUI<br/>COMFYUI_MOTION_URL"]
  end

  subgraph Models["Model assets outside this repo"]
    LTX_MODEL["LTX 2.3 model stack"]
    WAN_MODEL["WAN2.2 / VACE / Bernini model stack"]
    SCAIL_MODEL["HY-Motion / SCAIL2 model stack"]
    VOICE_MODEL["Optional LLM + CosyVoice"]
  end

  OUT["Generated media<br/>videos, images, audio, metadata"]

  USER --> UI --> SERVER
  SERVER --> RUNS
  SERVER --> Workflows
  LTX --> COMFY_MAIN --> LTX_MODEL
  WAN --> COMFY_MAIN --> WAN_MODEL
  MOTION --> COMFY_MOTION --> SCAIL_MODEL
  CAST --> VOICE_MODEL
  LTX_MODEL --> OUT
  WAN_MODEL --> OUT
  SCAIL_MODEL --> OUT
  VOICE_MODEL --> OUT
  OUT --> RUNS
  RUNS --> UI
```

## Backend

- Entry point: `server/camera_lab_server.py`
- Serves static files from `frontend/`
- Accepts generation requests
- Validates and stages media into ComfyUI input folders
- Builds or patches workflow API payloads
- Submits prompts to ComfyUI
- Polls results and writes local run history under `tasks/`

## Frontend

- Static browser UI in `frontend/`
- Workspaces: Camera Lab, Director, Edit, Motion, Casting
- Talks only to the Camera Lab HTTP server
- Reuses result history, upload controls, preview modals, and edit handoff menus

## Workflow Layer

Workflow sources are either:

- Checked-in JSON under `workflows/app/`
- Runtime builders inside `server/camera_lab_server.py`

The app patches workflows at request time instead of requiring users to edit
ComfyUI workflows manually.

## Runtime Data

Generated runs and uploaded files are written under:

- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`

Those folders are ignored by git.

## ComfyUI Boundary

Camera Lab does not vendor ComfyUI, models, or custom nodes. It expects ComfyUI
to be installed locally or provided by Docker. Model files remain outside this
repository.

