# Modular Install Flow Design

## Goal

Create a module-based setup path for Camera Lab so users can choose which workspaces to install, setup checks understand optional capabilities, and the frontend can hide tabs whose required dependencies are unavailable.

## Scope

This first pass covers setup and capability detection only. It does not split the large backend server into separate runtime packages, and it does not add a browser-based installer yet. The design should make those later steps straightforward by moving module metadata into a shared registry.

## Module Model

Camera Lab will define a module registry in Python. Each module represents one user-facing workspace or optional capability:

- `camera`: standard Camera Lab LTX image/video workflows.
- `director`: Director timeline workflows and WhatDreamsCost/LTX Director dependencies.
- `edit`: Bernini and VACE Inpaint workflows.
- `casting`: script, voice library, optional analysis, and optional TTS.
- `motion`: Text to Motion, SCAIL2, and 3D Motion.

Each module declares:

- Display label and short description.
- Workflow files to install.
- Required ComfyUI node types.
- Required model files grouped by ComfyUI model folder.
- Optional model/node capabilities that enable richer UI but do not block the module.
- Frontend tab ids or workspace ids controlled by the module.

## Installer

The first installer is a terminal command:

```powershell
python scripts/install_camera_lab.py
```

It supports interactive selection and non-interactive flags:

```powershell
python scripts/install_camera_lab.py --modules camera,director
python scripts/install_camera_lab.py --all
python scripts/install_camera_lab.py --list-modules
```

The installer creates `.env` from `.env.example` when missing, installs repo Python dependencies, optionally installs Node dependencies, and copies only the workflows for the selected modules into ComfyUI. It does not install ComfyUI, large model weights, or third-party custom nodes automatically.

## Setup Checks

`check_setup.py` will become module-aware. Instead of only checking `COMFYUI_ROOT/models`, it should prefer ComfyUI `/object_info` when the server is running, because `/object_info` already includes `extra_model_paths.yaml` and subfolders. When ComfyUI is offline, it can fall back to local path checks and report that shared-model visibility could not be confirmed.

The check output should separate:

- Core repo setup checks.
- Per-module readiness.
- Missing required dependencies.
- Optional capabilities.

A module is ready only when its required workflows, nodes, and models are visible. Optional missing items should be warnings, not failures.

## Frontend Capability Contract

The backend config endpoint should expose module readiness in a stable shape:

```json
{
  "modules": {
    "director": {
      "enabled": true,
      "ready": false,
      "missing": ["LTXDirector", "ltx-2.3-22b-dev-fp8.safetensors"]
    }
  }
}
```

The frontend should hide a workspace tab when `enabled` is false or `ready` is false. Hidden modules should not break routing: direct hashes like `#director` should redirect to the first ready workspace and show a concise status message.

## Error Handling

The installer should never claim full setup success when ComfyUI, required nodes, or required models are missing. It should print exact missing items and the module they affect. If ComfyUI is offline, it should still finish repo-side setup and explain which checks require a running ComfyUI server.

## Testing

Tests should cover the module registry, workflow selection, object-info model detection, offline fallback behavior, and config payload shape. Existing browser smoke tests should be adjusted so a deliberately missing module hides the matching tab while ready modules remain visible.

## Migration

Existing commands keep working:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
```

They can delegate to the new module-aware code. This preserves agent and user muscle memory while introducing the new `install_camera_lab.py` entry point.
