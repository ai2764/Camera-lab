# Workflow References

This folder contains ComfyUI workflow files that are useful for Camera Lab setup, comparison, and experimentation.

## Folders

- `app/`: Workflow files used directly by Camera Lab workflow options.
- `examples/`: Workflow files used during development or smoke testing. These are useful references, but they are not automatically listed in the Camera Lab frontend.
- `experimental/`: Experimental workflows for Director and IC-LoRA control research. These are not guaranteed to be one-click production workflows.

## Notes

- ComfyUI, models, and custom nodes are not vendored in this repository.
- Workflow files may still require local ComfyUI models and custom nodes listed in `AGENTS.md` or `dependency-manifest.json`.
- Machine-specific output metadata and absolute local paths should not be committed.

## Install into ComfyUI

ComfyUI does not read workflow files directly from this repository.

Copy app and example workflows into your local ComfyUI workflow folder with:

```powershell
.\scripts\install_workflows.ps1
```

This installs JSON files under:

```text
<COMFYUI_ROOT>\user\default\workflows\camera-lab\
```

To include experimental workflows too:

```powershell
.\scripts\install_workflows.ps1 -IncludeExperimental
```
