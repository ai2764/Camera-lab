# Workflow References

This folder contains ComfyUI workflow files that are useful for Camera Lab setup and experimentation.

## Folders

- `app/`: Workflow files shipped with Camera Lab and installed for app use.
- `experimental/`: Experimental workflows for Director and IC-LoRA control research. These are not guaranteed to be one-click production workflows.

## Notes

- ComfyUI, models, and custom nodes are not vendored in this repository.
- Workflow files may still require local ComfyUI models and custom nodes listed in `AGENTS.md` or `dependency-manifest.json`.
- Machine-specific output metadata and absolute local paths should not be committed.

## App Workflow Map

- `ltx23_nag_i2v_extendcrop_general.json`: `LTX 2.3 NAG I2V Extendcrop`
- `LTX-2.3_FML2V_RuneXX_guider.local.json`: `LTX 2.3 FML RuneXX Guider Local (3 images)`
- `ltx23_nag_ia2v_extendcrop_general.json`: `LTX 2.3 IA2V`
- `ltx_director_reference_mvp.json`: `LTX Director Reference MVP`

The `FLF TTP Control` and `FML 2-stage TTP FLF` dropdown options are built in `server/camera_lab_server.py`, so they do not have standalone workflow JSON files.

## Install into ComfyUI

ComfyUI does not read workflow files directly from this repository.

Copy app workflows into your local ComfyUI workflow folder with:

```bash
python scripts/install_workflows.py
```

This installs JSON files under:

```text
<COMFYUI_ROOT>/user/default/workflows/camera-lab/
```

To include experimental workflows too:

```bash
python scripts/install_workflows.py --include-experimental
```
