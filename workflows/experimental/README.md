# Experimental Workflows

## Yedp + LTX 2.3 Union Control Canny

Workflow:

`Yedp_LTX-2.3_ICLoRA_Union_Control_Canny.local.json`

Purpose:

Validate whether a browser-baked 3D Action Director pass can drive LTX 2.3 IC-LoRA Union Control.

Current wiring:

- `YedpActionDirector.CANNY_BATCH`
- `ResizeImageMaskNode`
- `LTXAddVideoICLoRAGuide`

The original official workflow's `CannyEdgePreprocessor` node is left muted as a fallback reference.

Use:

1. Open the workflow in ComfyUI.
2. In the Yedp Action Director node, assemble the 3D camera/action scene.
3. Click `BAKE` in the Yedp viewport so `client_data` is populated.
4. Queue the workflow.

Notes:

- Yedp must be installed under ComfyUI `custom_nodes`.
- ComfyUI must be restarted after installing Yedp.
- This first workflow tests Canny-style structure control only. Pose and Depth outputs are available from Yedp but are not wired in this workflow yet.
