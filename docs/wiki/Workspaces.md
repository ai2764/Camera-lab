# Workspaces

Camera Lab has five user-facing workspaces.

## Camera Lab

Camera Lab is the core shot-generation workspace for creating short AI video
clips from prompts, image references, camera moves, seeds, and reusable LTX
workflow presets.

The browser collects prompt, seed, frame size, duration, camera move, and source
images. The Python server validates media, patches the selected LTX workflow or
runtime builder, submits it to ComfyUI, and records generated media back into
run history.

## Director

Director is a structured timeline workspace for longer videos. It supports:

- Main timeline segments
- Image and video visual guides
- Video-audio clips
- Dialogue audio clips
- IC reference clips
- Retake mode for selecting part of an existing Director output

Retake ranges can be sent into compatible Edit workflows. Retake-sourced edit
runs can be stitched back into the original Director output.

## Edit

Edit groups WAN2.2 Bernini and WAN VACE Inpaint workflows into one workspace.

Bernini modes:

- T2V
- I2V
- V2V
- MV2V
- VI2V
- VRC2V
- R2V
- RV2V
- ADS2V

Inpaint requires:

- Source video
- Painted mask image

The Inpaint reference image is optional.

Generated video result cards include an Edit menu when the output can be reused
as an input. Video upload fields share the clip editor modal.

## Motion

Motion drives character-motion workflows. It has three tools:

- Text to Motion: HY-Motion turns text into a pose guide video.
- SCAIL2: renders a pose guide onto a reference character image.
- 3D Motion: records browser-generated rig motion and uses it as a guide.

Motion can use the main ComfyUI endpoint or an optional dedicated motion ComfyUI
endpoint.

## Casting

Casting prepares dialogue and voice assets. It can:

- Turn scripts into dialogue lines
- Assign speakers, emotions, and voices
- Manage a local voice library
- Generate speech clips with CosyVoice when configured

Casting degrades safely. The UI still works when optional LLM or TTS services
are offline.

