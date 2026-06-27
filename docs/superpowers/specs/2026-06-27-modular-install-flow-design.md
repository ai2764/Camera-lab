# Modular Install Flow Design

## Goal

Create a module-based setup path for Camera Lab so the installer can evaluate the user's hardware, recommend installable workspaces, choose suitable model profiles, setup checks understand optional capabilities, and the frontend can hide tabs whose required dependencies are unavailable.

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
- Hardware requirements for minimum and recommended use.
- Model profiles for low, medium, and high resource configurations.
- Frontend tab ids or workspace ids controlled by the module.

## Hardware Profile

The installer should build a `HardwareProfile` before asking which modules to install. The profile should include:

- GPU vendor and model name when detectable.
- Total GPU VRAM in GiB.
- System RAM in GiB.
- Free disk space for the repository drive and configured ComfyUI/model drives.
- Operating system.
- Python version.
- ComfyUI reachability and version when the server is running.
- CUDA availability when detectable through ComfyUI, PyTorch, or `nvidia-smi`.

The installer must continue when some hardware facts are unknown. Unknown values should reduce recommendation confidence but should not block repo-side setup.

## Model Profiles

Modules can expose multiple model profiles. A profile declares:

- Human label, such as `Low VRAM`, `Balanced`, or `High Quality`.
- Required model files and their expected ComfyUI folders.
- Recommended minimum VRAM and RAM.
- Approximate download or disk footprint.
- Required custom nodes.
- Feature flags enabled by this profile.

The resolver should prefer profiles that match the current hardware and already-installed models. If a lower-quality profile is already present and a higher-quality profile would require large downloads, the installer should recommend the present profile and offer the upgrade as optional.

Example Director profiles:

- `Director v1 LTX 2.3 FP8`: uses `ltx-2.3-22b-dev-fp8.safetensors` plus distilled LoRA.
- `Director v2 Distilled FP8`: uses `ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors`.
- `Director v2 Motion Guidance`: adds IC-LoRA motion models and marks motion guidance as optional unless the models are present.

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

Before module selection, the installer prints a concise hardware summary and the module resolver's recommendation:

- `Recommended`: hardware and required models/nodes are available, or the missing items are small and clearly documented.
- `Available with downloads`: hardware is suitable but required model files are missing.
- `Risky`: hardware is below the recommended profile but may work with low-VRAM settings.
- `Unavailable`: required nodes are missing or the module cannot be installed without manual ComfyUI/custom node setup.

Users can accept the recommendation, choose a different profile, or skip a module. The installer should warn before selecting a risky profile but allow override.

## Setup Checks

`check_setup.py` will become module-aware. Instead of only checking `COMFYUI_ROOT/models`, it should prefer ComfyUI `/object_info` when the server is running, because `/object_info` already includes `extra_model_paths.yaml` and subfolders. When ComfyUI is offline, it can fall back to local path checks and report that shared-model visibility could not be confirmed.

The check output should separate:

- Core repo setup checks.
- Hardware profile summary.
- Per-module readiness.
- Selected model profile.
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
      "profile": "director-v2-distilled-fp8",
      "missing": ["LTXDirector", "ltx-2.3-22b-dev-fp8.safetensors"]
    }
  }
}
```

The frontend should hide a workspace tab when `enabled` is false or `ready` is false. Hidden modules should not break routing: direct hashes like `#director` should redirect to the first ready workspace and show a concise status message. If a module is ready but a profile-specific optional capability is missing, the tab stays visible and the specific controls are hidden or disabled.

## Error Handling

The installer should never claim full setup success when ComfyUI, required nodes, required models, or selected model profiles are missing. It should print exact missing items and the module/profile they affect. If ComfyUI is offline, it should still finish repo-side setup and explain which checks require a running ComfyUI server. Hardware warnings should be explicit about risk, for example "8 GiB VRAM detected; Director v2 Distilled FP8 is expected to need more VRAM, so low-VRAM execution may be slow or fail."

## Testing

Tests should cover the module registry, hardware profile parsing, model profile selection, workflow selection, object-info model detection, offline fallback behavior, and config payload shape. Existing browser smoke tests should be adjusted so a deliberately missing module hides the matching tab while ready modules remain visible.

## Migration

Existing commands keep working:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
```

They can delegate to the new module-aware code. This preserves agent and user muscle memory while introducing the new `install_camera_lab.py` entry point.
