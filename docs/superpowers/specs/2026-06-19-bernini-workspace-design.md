# Bernini Workspace Design

## Goal

Add a first-class Bernini workspace to Camera Lab so the six WAN2.2 Bernini task workflows can be selected from a dedicated tab and run with the inputs each task actually requires.

## Scope

- Add a top-level `Bernini` workspace tab.
- Add six Bernini sub tabs: `T2V`, `I2V`, `V2V`, `R2V`, `RV2V`, and `ADS2V`.
- Register the six existing workflow files in the backend workflow list.
- Add video upload support for Bernini workflows that use `VHS_LoadVideo`.
- Patch Bernini workflow prompts, dimensions, frame length, image inputs, and video inputs before queueing to ComfyUI.
- Keep generated results in the existing result/history UI.

Out of scope: new Bernini-specific history pages, model installation automation, ComfyUI workflow authoring, or changes to non-Bernini workflow behavior.

## User Experience

The top workspace navigation gains a `Bernini` tab next to the existing app tabs. Inside it, a compact sub-tab bar exposes the six tasks.

Each sub tab shows only its main inputs:

- `T2V`: prompt only.
- `I2V`: source image.
- `V2V`: source video.
- `R2V`: reference image.
- `RV2V`: source video and reference image.
- `ADS2V`: source video and reference video.

The existing shared controls remain the source of truth for prompt, negative prompt, duration, size, seed, and queue/run behavior. Image upload should feel the same as existing Camera Lab image inputs. Video upload should mirror that pattern: file input, upload status, saved path in client state, and payload submission through `/api/run`.

## Backend Design

Add six workflow entries backed by:

- `workflows/app/wan22_bernini_t2v.ui.json`
- `workflows/app/wan22_bernini_i2v.ui.json`
- `workflows/app/wan22_bernini_v2v.ui.json`
- `workflows/app/wan22_bernini_r2v.ui.json`
- `workflows/app/wan22_bernini_rv2v.ui.json`
- `workflows/app/wan22_bernini_ads2v.ui.json`

Use Bernini-specific modes so validation and patching can distinguish image, video, and reference requirements without overloading the existing LTX modes.

Add `/api/upload-video` for common local video formats and store files under `tasks/camera_lab_uploads/videos`.

During queue preparation:

- Image inputs are copied to ComfyUI `input` as resized images when they feed `LoadImage`.
- Video inputs are copied to ComfyUI `input` unchanged.
- `VHS_LoadVideo` nodes receive the copied video filename.
- `LoadImage` nodes receive the copied image filename.
- `BerniniConditioning` receives `width`, `height`, and `length`, where `length` is derived from duration at 24 fps.
- Prompt and negative prompt are patched into the positive and negative `CLIPTextEncode` nodes.

## Frontend Design

State gains Bernini-specific fields for the active task and uploaded media:

- active Bernini workflow id.
- source video path/name.
- reference video path/name.
- reference image path/name.

The existing source image slot can continue to represent Bernini source/reference image inputs where possible, but labels and payload mapping must be task-aware so `R2V` sends its image as a reference input instead of a source video.

Switching Bernini sub tabs updates the selected workflow id and refreshes visible inputs. It should not clear uploaded files unless the user uploads replacements.

## Error Handling

Frontend required-input validation remains lightweight; the backend is authoritative. Backend validation should return clear errors:

- missing source image.
- missing reference image.
- missing source video.
- missing reference video.
- unsupported video file type.
- video file too large.

Unavailable Bernini workflows should remain disabled in the workflow data if required models are missing, consistent with existing workflow behavior.

## Testing

Add focused backend tests for:

- Bernini workflow registration.
- required input validation per task.
- `/api/upload-video` file type and size handling where practical.
- Bernini API patching for `LoadImage`, `VHS_LoadVideo`, and `BerniniConditioning`.

Add or update E2E tests for:

- `Bernini` tab is visible.
- six sub tabs are visible.
- switching sub tabs changes visible main inputs.
- payload collection includes the expected media paths for representative image and video tasks.

Existing Director and Camera Lab tests should continue to pass.
