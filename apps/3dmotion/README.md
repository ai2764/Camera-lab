# 3D Motion Stage

Frontend prototype for recording SCAIL-2 driving videos from a simple 3D motion guide.

## What It Does

- Runs a Three.js stage in the browser.
- Uses the Mesh2Motion human and action set extracted from the ComfyUI node.
- Lets you build and edit an action sequence from the node action buttons.
- Records synchronized RGB and mask WebM exports:
  - `rendered_v2.webm`
  - `rendered_mask_v2.webm`
- Records and replays manual camera takes for export.
- Sends the current motion guide plus a reference image to local SCAIL-2 and previews the result video.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL.

## Stable Workflow

1. Choose Mesh2Motion node actions from the action library.
2. Edit clip durations or delete clips in the timeline.
3. Optionally record a camera take.
4. Export RGB/mask videos or choose a reference image and click `Generate With SCAIL-2`.

## Camera Take Workflow

1. Set up the timeline.
2. Click `Record Camera Take`.
3. Move the camera while the action plays.
4. Click `Stop Camera Take`.
5. Click `Export Take` or `Generate With SCAIL-2`.

If a camera take exists, export replays that path for both RGB and mask renders. If no take exists, export uses the current static camera.

## SCAIL-2 Generation

1. Start the local ComfyUI-SCAIL server on `http://127.0.0.1:8188`.
2. Choose a reference image in the `SCAIL-2` panel.
3. Click `Generate With SCAIL-2`.

The app exports the current motion-guide video for the current timeline duration, converts the driving video to MP4 for ComfyUI, uploads the reference image, submits the SCAIL-2 workflow, and shows both the guide video and final result preview.

## Notes

The fuller experimental version with external avatar loading and Motion JSON control is preserved on the `full-scope-before-scope-down` branch.
