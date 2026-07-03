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

- `ltx23_i2v_subtitle_cleaner_nag_extend.json`: `LTX 2.3 I2V Subtitle Cleaner`
- `ltx23_flf_subtitle_cleaner_nag_extend.json`: `LTX 2.3 FLF (2 images, audio)`
- Built in `server/camera_lab_server.py`: `LTX 2.3 FML (3 images, 2-stage, audio)`
- `LTX-2.3_FML2V_RuneXX_guider.local.json`: `LTX 2.3 FML RuneXX Guider Local (3 images)`
- `ltx23_nag_ia2v_extendcrop_general.json`: `LTX 2.3 IA2V`
- `ltx23_flf_ia2v_nag_extend.json`: `LTX 2.3 FLF IA2V (2 images + audio)`
- `ltx_director_2.json`: `LTX Director 2`
- `ltx_director_reference_mvp.json`: legacy Director reference workflow
- `wan22_bernini_t2v.ui.json`: `WAN2.2 Bernini T2V`
- `wan22_bernini_t2i.ui.json`: `WAN2.2 Bernini T2I`
- `wan22_bernini_i2v.ui.json`: `WAN2.2 Bernini I2V`
- `wan22_bernini_i2i.ui.json`: `WAN2.2 Bernini I2I`
- `wan22_bernini_v2v.ui.json`: `WAN2.2 Bernini V2V`
- `wan22_bernini_mv2v.ui.json`: `WAN2.2 Bernini MV2V`
- `wan22_bernini_vi2v.ui.json`: `WAN2.2 Bernini VI2V`
- `wan22_bernini_vrc2v.ui.json`: `WAN2.2 Bernini VRC2V`
- `wan22_bernini_r2v.ui.json`: `WAN2.2 Bernini R2V`
- `wan22_bernini_r2i.ui.json`: `WAN2.2 Bernini R2I`
- `wan22_bernini_rv2v.ui.json`: `WAN2.2 Bernini RV2V`
- `wan22_bernini_ads2v.ui.json`: `WAN2.2 Bernini ADS2V`
- `wan_vace_inpainting.ui.json`: `WAN VACE Inpaint`

Some dropdown options are built in `server/camera_lab_server.py`, so they do not have standalone workflow JSON files.

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
