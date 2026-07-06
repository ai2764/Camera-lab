# Models And Workflows

Camera Lab does not download models automatically. The launcher and setup checks
only report what is ready, what is missing, and where missing files should go.

## Expected ComfyUI Layout

Camera Lab reads these paths from `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user/default/workflows`
- `custom_nodes/Comfyui_TTP_Toolset`

## Docker Model Mount

For Docker modes, the host `MODELS_DIR` is mounted into the ComfyUI container at:

```text
/opt/ComfyUI/models
```

Set `MODELS_DIR` to the folder that contains ComfyUI model subfolders such as:

- `checkpoints`
- `diffusion_models`
- `text_encoders`
- `vae`
- `loras`
- `latent_upscale_models`

## Model Guide Tags

The launcher prints model guide rows with these tags:

- `[ok]`: ComfyUI can see the model.
- `[missing]`: ComfyUI is running, but the model is missing.
- `[needed]`: ComfyUI was not detected, so Camera Lab can only list what will be needed.

## Bundled Workflows

Camera Lab stores app workflow files under:

- `workflows/app/`

Install them into ComfyUI with:

```powershell
python scripts/install_workflows.py
```

The destination is:

```text
<COMFYUI_ROOT>/user/default/workflows/camera-lab/
```

Experimental workflow references live under:

- `workflows/experimental/`

Install experimental workflows only when needed:

```powershell
python scripts/install_workflows.py --include-experimental
```

## Frontend Workflow Mapping

- `LTX 2.3 I2V Subtitle Cleaner`: `workflows/app/ltx23_i2v_subtitle_cleaner_nag_extend.json`
- `LTX 2.3 FLF (2 images, audio)`: `workflows/app/ltx23_flf_subtitle_cleaner_nag_extend.json`
- `LTX 2.3 FML (3 images, 2-stage, audio)`: built in `server/camera_lab_server.py`
- `LTX 2.3 FML RuneXX Guider Local (3 images)`: `workflows/app/LTX-2.3_FML2V_RuneXX_guider.local.json`
- `LTX 2.3 IA2V`: `workflows/app/ltx23_nag_ia2v_extendcrop_general.json`
- `LTX 2.3 FLF IA2V (2 images + audio)`: `workflows/app/ltx23_flf_ia2v_nag_extend.json`
- `LTX Director 2`: `workflows/app/ltx_director_2.json`
- `WAN2.2 Bernini T2V`: `workflows/app/wan22_bernini_t2v.ui.json`
- `WAN2.2 Bernini T2I`: `workflows/app/wan22_bernini_t2i.ui.json`
- `WAN2.2 Bernini I2V`: `workflows/app/wan22_bernini_i2v.ui.json`
- `WAN2.2 Bernini I2I`: `workflows/app/wan22_bernini_i2i.ui.json`
- `WAN2.2 Bernini V2V`: `workflows/app/wan22_bernini_v2v.ui.json`
- `WAN2.2 Bernini MV2V`: `workflows/app/wan22_bernini_mv2v.ui.json`
- `WAN2.2 Bernini VI2V`: `workflows/app/wan22_bernini_vi2v.ui.json`
- `WAN2.2 Bernini VRC2V`: `workflows/app/wan22_bernini_vrc2v.ui.json`
- `WAN2.2 Bernini R2V`: `workflows/app/wan22_bernini_r2v.ui.json`
- `WAN2.2 Bernini R2I`: `workflows/app/wan22_bernini_r2i.ui.json`
- `WAN2.2 Bernini RV2V`: `workflows/app/wan22_bernini_rv2v.ui.json`
- `WAN2.2 Bernini ADS2V`: `workflows/app/wan22_bernini_ads2v.ui.json`
- `WAN VACE Inpaint`: `workflows/app/wan_vace_inpainting.ui.json`

