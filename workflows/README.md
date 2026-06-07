# Workflow References

This folder contains ComfyUI workflow files that are useful for Camera Lab setup, comparison, and experimentation.

## Folders

- `app/`: Workflow files used directly by Camera Lab workflow options.
- `experimental/`: Experimental workflows for Director and IC-LoRA control research. These are not guaranteed to be one-click production workflows.

## Notes

- ComfyUI, models, and custom nodes are not vendored in this repository.
- Workflow files may still require local ComfyUI models and custom nodes listed in `AGENTS.md` or `dependency-manifest.json`.
- Machine-specific output metadata and absolute local paths should not be committed.
