# Camera Control Test Recovery Log

This file is append-only. Use it to resume testing after terminal loss, browser refresh, chat compaction, ComfyUI interruption, or a long break.

## 2026-05-30 Initial Checkpoint

### Current State

- active_round: not started
- active_move: none
- active_workflow: none
- active_prompt_level: none
- active_image_set: pending
- active_seed_set: baseline seed ladder from `camera-control-testing-plan.md`
- active_size: `16:9 1280x720`
- active_batch_id: none
- comfy_status: Camera Lab config last verified available
- camera_lab_url: `http://127.0.0.1:8766`

### Decisions Made

- kept: testing will use an append-only recovery log.
- rejected: relying on terminal scrollback or chat memory.
- changed: every batch and review step must write a checkpoint before continuing.
- reason: testing must be resumable even if the terminal or session is lost.

### Next Exact Action

1. Confirm source image set and labels.
2. Run Round 0 calibration for I2V SFX with Dolly Push In.
3. Verify output video includes an audio stream.

## 2026-05-30 Round 0 Calibration Start

### Current State

- active_round: Round 0 Calibration
- active_move: Dolly Push In
- active_workflow: `i2v_sfx_extendcrop`
- active_prompt_level: calibration candidate
- active_image_set: `xiaomei_i2v_street`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: pending
- comfy_status: pending live check
- camera_lab_url: `http://127.0.0.1:8766`

### Decisions Made

- kept: use the street/depth Xiaomei image for calibration because Dolly Push In needs visible parallax.
- rejected: starting with portrait-only image because it may hide whether camera motion is working.
- changed: begin with one run only before launching multi-run tests.
- reason: verify workflow/audio path first so later failures are about camera control, not infrastructure.

### Next Exact Action

1. POST one I2V SFX Dolly Push In run to Camera Lab.
2. Wait for completion.
3. Run `ffprobe` on the output mp4 and record whether an audio stream exists.

## 2026-05-30 Round 0 Calibration Queued

### Current State

- active_round: Round 0 Calibration
- active_move: Dolly Push In
- active_workflow: `i2v_sfx_extendcrop`
- active_prompt_level: calibration candidate
- active_image_set: `xiaomei_i2v_street`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780127529_4456`
- comfy_status: available at queue time
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| batch_id | run_ids | workflow | move | prompt_level | seeds | images | status |
|---|---|---|---|---|---|---|---|
| camera_lab_1780127529_4456 | 01_prompt | i2v_sfx_extendcrop | dolly_push_in | calibration candidate | 1626970716 | xiaomei_i2v_street | running |

### Decisions Made

- kept: one-run calibration before multi-run testing.
- rejected: launching full Round 1 before audio verification.
- changed: active batch is now `camera_lab_1780127529_4456`.
- reason: this batch validates that the I2V SFX workflow is usable for the test campaign.

### Next Exact Action

1. Poll `camera_lab_1780127529_4456` until done or error.
2. If done, run `ffprobe` on the mp4.
3. Record audio stream result and visual first impression.

## 2026-05-30 Round 0 Calibration Completed

### Current State

- active_round: Round 0 Calibration
- active_move: Dolly Push In
- active_workflow: `i2v_sfx_extendcrop`
- active_prompt_level: calibration candidate
- active_image_set: `xiaomei_i2v_street`
- active_seed_set: `1626970716`
- active_size: requested `1280x720`, output `1280x916`
- active_batch_id: `camera_lab_1780127529_4456`
- comfy_status: completed
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| camera_lab_1780127529_4456 | 01_prompt | `tasks/camera_lab_runs/camera_lab_1780127529_4456/01_prompt/01_prompt_00001_.mp4` | calibration pass | keep | video completed, has AAC audio stream, Dolly Push In is visually readable |

### Observation

- visual: subject grows larger over time with a readable push-in; background perspective shifts mildly.
- identity: acceptable for calibration; some frame-to-frame face softness but no hard identity break in contact sheet.
- camera motion: camera move reads more like physical push than pure zoom, though parallax is moderate.
- audio/SFX: present; `ffprobe` shows one H.264 video stream and one AAC stereo audio stream.
- unexpected behavior: requested `1280x720`, output is `1280x916`; likely workflow crop/extension behavior from SFX extendcrop.

### Decisions Made

- kept: I2V SFX workflow is valid for audio-capable testing.
- rejected: reverting to the old simple I2V workflow because it produced no audio stream.
- changed: record output resolution as a workflow-side variable in later runs.
- reason: camera-control scoring can proceed, but size/aspect scoring must account for extendcrop output.

### Next Exact Action

1. Build the six-class source image set for Round 1.
2. Label each image with depth, foreground, subject size, line structure, and identity risk.
3. Start Round 1 image sensitivity for the representative move set.

## 2026-05-30 Round 1A Source Set Selected

### Current State

- active_round: Round 1A Image Sensitivity Smoke Test
- active_move: Dolly Push In
- active_workflow: `i2v_sfx_extendcrop`
- active_prompt_level: Level C / physical push-in candidate
- active_image_set: six source classes listed below
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: pending
- comfy_status: available after Round 0
- camera_lab_url: `http://127.0.0.1:8766`

### Source Image Labels

| image_id | path | depth | foreground | subject_size | line_structure | identity_risk |
|---|---|---|---|---|---|---|
| street_depth_night | `assets/references/xiaomei_i2v_camera_test_street.png` | high | medium | medium | strong | medium |
| front_portrait_flat | `tasks/LTX_camera_prompt_suite_xiaomei/references/avatar.png` | low | none | close | weak | low |
| side_profile_flat | `tasks/LTX_camera_prompt_suite_xiaomei/references/xiaomei_side_profile_landscape.png` | low | none | close | weak | medium |
| street_depth_day | `tasks/LTX_camera_prompt_suite_xiaomei_street/camera_prompt_suite_1779567985/camera_prompt_ref_1280x720.png` | high | weak | medium | strong | medium |
| foreground_occluder | `tasks/LTX_camera_prompt_suite_xiaomei_street/flf_2stage_flf_foreground_pass_1779577774/flf_foreground_pass_end_1280x720.png` | high | strong | medium | strong | high |
| full_body_flat | `tasks/LTX_camera_prompt_suite_xiaomei_street/318c3dbb-a135-4be8-9cb8-f649c77b29ab.png` | low | none | wide | weak | medium |

### Decisions Made

- kept: six image classes from local assets, not generated new images yet.
- rejected: running full 18-run Round 1 immediately.
- changed: add Round 1A smoke test with one seed across six images.
- reason: if the workflow has size/crop quirks, a 6-run image sweep exposes them before spending 18 runs per move.

### Next Exact Action

1. Queue six I2V SFX Dolly Push In runs using seed `1626970716`.
2. Wait for all six batches to finish.
3. Compare contact sheets and score image sensitivity.

## 2026-05-30 Baseline Correction: No NAG, No Subtitle Crop, Two-Stage Sampling

### Current State

- active_round: baseline correction before Round 1A
- active_move: Dolly Push In
- active_workflow: switching from `i2v_sfx_extendcrop` to `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_image_set: six source classes already selected
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: none queued after correction
- comfy_status: pending server restart
- camera_lab_url: `http://127.0.0.1:8766`

### Decisions Made

- kept: use the six selected source image classes for image sensitivity.
- rejected: NAG workflows, padcrop workflows, extendcrop workflows, and the earlier I2V SFX calibration as a true camera-control baseline.
- changed: I2V baseline is now the ComfyUI built-in LTX 2.3 I2V local template expanded from subgraph.
- reason: this study is about camera control, not subtitle removal; NAG/crop introduces unrelated variables.

### Two-Stage Sampling Check

- expanded template contains exactly two `SamplerCustomAdvanced` nodes.
- first sampling segment uses `ManualSigmas` with the longer schedule.
- second sampling segment uses `ManualSigmas` beginning at `0.85`.
- `LTXVLatentUpsampler` sits between the two sampling segments.
- strict no-crop correction: the template's internal `LTXVCropGuides` node is bypassed in `patch_api`, so the submitted API prompt should contain no crop guide node.

### Notes

- The previous calibration run `camera_lab_1780127529_4456` is useful only as an audio/workflow debugging clip.
- It must not be scored as part of the final no-NAG/no-crop camera-control experiment.

### Next Exact Action

1. Restart Camera Lab server with `i2v_official_local`.
2. Re-run Round 0 calibration using the no-NAG/no-subtitle-crop two-stage I2V baseline.
3. Only after calibration passes, queue Round 1A image sensitivity.

## 2026-05-30 Official Local Baseline Server Restored

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: pending
- comfy_status: Camera Lab config reports `i2v_official_local` available
- camera_lab_url: `http://127.0.0.1:8766`

### Decisions Made

- kept: `i2v_official_local` as the I2V baseline.
- rejected: old SFX extendcrop calibration as formal evidence.
- changed: server restarted after subgraph expansion and crop-guide bypass.
- reason: formal tests must use no NAG, no crop guide, two-stage sampling.

### Next Exact Action

1. Queue a single Round 0 calibration run.
2. Verify completion, audio stream, resolution, and API prompt class list.
3. If it passes, start Round 1A image sensitivity.

## 2026-05-30 Official Local Round 0 Queued

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780128358_8572`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| batch_id | run_ids | workflow | move | prompt_level | seeds | images | status |
|---|---|---|---|---|---|---|---|
| camera_lab_1780128358_8572 | 01_prompt | i2v_official_local | dolly_push_in | calibration candidate | 1626970716 | street_depth_night | running |

### Next Exact Action

1. Poll `camera_lab_1780128358_8572`.
2. Check API prompt for no NAG/no Crop class/two `SamplerCustomAdvanced`.
3. Check output video stream and contact sheet.

## 2026-05-30 Official Local Round 0 Failed Validation

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780128358_8572`
- comfy_status: ComfyUI rejected prompt validation
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| camera_lab_1780128358_8572 | 01_prompt | none | infrastructure fail | reject | official local template validation failed before generation |

### Error

- node `285` `LoraLoaderModelOnly`: `ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors` not in local LoRA list.
- node `324` `LoraLoader`: `gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors` not in local LoRA list.
- node `325` `TextGenerateLTX2Prompt`: missing `sampling_mode.seed`, `temperature`, `top_p`, `min_p`, `top_k`, `repetition_penalty`.

### Decisions Made

- kept: no-NAG/no-crop-guide/two-stage target.
- rejected: scoring this failed run.
- changed: next step is local template compatibility patch, not prompt testing.
- reason: Comfy validation must pass before camera tests are meaningful.

### Next Exact Action

1. Inspect local LoRA filenames and object info for `TextGenerateLTX2Prompt`.
2. Patch official local workflow inputs to local model names and prompt enhancer defaults.
3. Re-run Round 0 calibration.

## 2026-05-30 Official Local Compatibility Patch

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| item | result |
|---|---|
| subgraph link expansion | fixed generated external link ids so official-template internal links do not collide with rewired links |
| prompt enhancer | disabled for formal I2V tests; removed `TextGenerateLTX2Prompt` and Gemma LoRA branch from generated API |
| LoRA compatibility | mapped missing official distilled LoRA filename to local `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` |
| crop/NAG check | generated API has no NAG nodes and no Crop/CropGuide nodes |
| sampling check | generated API still has two `SamplerCustomAdvanced` nodes |
| server | restarted Camera Lab on `http://127.0.0.1:8766`; ComfyUI remains `ok` on `http://127.0.0.1:8000` |

### Decisions Made

- kept: ComfyUI built-in local LTX 2.3 I2V template as formal baseline.
- rejected: prompt enhancer for camera-control testing.
- changed: local compatibility patch now happens at API generation time, not by editing the installed ComfyUI template.
- reason: the experiment must isolate camera-motion prompt sensitivity, not text-enhancer behavior or subtitle/crop logic.

### Next Exact Action

1. Queue a single Round 0 calibration run with the patched official local I2V baseline.
2. Verify no NAG/no crop/no prompt enhancer/two-stage in the saved `api_prompt.json`.
3. If generation completes, inspect resolution, audio stream, and contact sheet before starting image sensitivity.

## 2026-05-30 Official Local Round 0 Re-Queued

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780128691_7388`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| batch_id | run_ids | workflow | move | prompt_level | seeds | images | status |
|---|---|---|---|---|---|---|---|
| camera_lab_1780128691_7388 | 01_prompt | i2v_official_local | dolly_push_in | calibration candidate | 1626970716 | street_depth_night | running |

### Next Exact Action

1. Poll `camera_lab_1780128691_7388`.
2. Verify saved API prompt class list.
3. If complete, inspect output stream metadata and contact sheet.

## 2026-05-30 Official Local Round 0 Hidden Submit Error

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780128691_7388`
- comfy_status: ComfyUI returned `node_errors` in `/prompt`
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| camera_lab_1780128691_7388 | 01_prompt | none | infrastructure fail | reject | Comfy accepted a `prompt_id` but returned `node_errors`; no output video was produced |

### Error

- node `290` `ResizeImageMaskNode`: `scale_method` received `center`, but valid values are interpolation methods such as `lanczos`.
- root cause: dynamic widget mapping put the crop mode into the interpolation field.
- server gap: `/prompt` `node_errors` were not treated as a failed submission.

### Decisions Made

- kept: patched official local I2V baseline.
- rejected: marking `camera_lab_1780128691_7388` as a completed camera test.
- changed: service now raises on `/prompt.node_errors` and explicitly sets `ResizeImageMaskNode` dynamic fields as `scale dimensions`, `center` crop, `lanczos` interpolation.
- reason: silent infrastructure failures would corrupt later prompt/seed comparisons.

### Next Exact Action

1. Restart Camera Lab with the node-error and resize-field patches.
2. Queue the same Round 0 calibration again.
3. Verify actual copied output video before scoring.

## 2026-05-30 Official Local Round 0 Re-Queued After Resize Patch

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- active_size: `16:9 1280x720`
- active_batch_id: `camera_lab_1780128800_4296`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| batch_id | run_ids | workflow | move | prompt_level | seeds | images | status |
|---|---|---|---|---|---|---|---|
| camera_lab_1780128800_4296 | 01_prompt | i2v_official_local | dolly_push_in | calibration candidate | 1626970716 | street_depth_night | running |

### Next Exact Action

1. Poll `camera_lab_1780128800_4296`.
2. Confirm `submit.json` has no `node_errors`.
3. Inspect actual copied output video and metadata.

## 2026-05-30 Official Local Round 0 Passed Infrastructure

### Current State

- active_round: Round 0 Calibration retry
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: calibration candidate
- active_image_set: `street_depth_night`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704`
- active_batch_id: `camera_lab_1780128800_4296`
- comfy_status: done
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| camera_lab_1780128800_4296 | 01_prompt | `tasks/camera_lab_runs/camera_lab_1780128800_4296/01_prompt/01_prompt_00001_.mp4` | infrastructure pass, visual provisional | keep as baseline calibration | no NAG, no crop-guide node, no prompt enhancer, two `SamplerCustomAdvanced`; video and audio streams present |

### Verification

- `submit.json`: no `node_errors`.
- `api_prompt.json`: no NAG nodes, no Crop/CropGuide nodes, no `TextGenerateLTX2Prompt`, no Gemma `LoraLoader`.
- `api_prompt.json`: two `SamplerCustomAdvanced` nodes remain.
- `ffprobe`: video stream H.264, `1280x704`, 24 fps, 97 frames, 4.041667 seconds.
- `ffprobe`: audio stream AAC stereo, 48 kHz, 4.041 seconds.
- contact sheet: dolly push-in is readable; identity/pose drift remains a scoring risk.

### Decisions Made

- kept: seed `1626970716` as initial dolly calibration seed.
- rejected: treating requested `1280x720` as guaranteed actual output size.
- changed: formal logs must record both requested size and actual output size.
- reason: the LTX 2.3 template appears to quantize generated video height to a model-compatible dimension.

### Next Exact Action

1. Commit this infrastructure milestone.
2. Start Round 1A image sensitivity using the same prompt and seed across selected source-image classes.
3. Score motion readability, identity stability, parallax evidence, and artifact severity.

## 2026-05-30 Round 1A Image Sensitivity Queued

### Current State

- active_round: Round 1A Image Sensitivity
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| image_id | batch_id | run_id | workflow | move | prompt_level | seed | status |
|---|---|---|---|---|---|---|---|
| street_depth_night | camera_lab_1780129011_9675 | 01_street_depth_night | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| front_portrait_flat | camera_lab_1780129012_8722 | 01_front_portrait_flat | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| side_profile_flat | camera_lab_1780129013_7008 | 01_side_profile_flat | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| street_depth_day | camera_lab_1780129014_4782 | 01_street_depth_day | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| foreground_occluder | camera_lab_1780129015_1671 | 01_foreground_occluder | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| full_body_flat | camera_lab_1780129016_7184 | 01_full_body_flat | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |

### Decisions Made

- kept: same prompt and seed as the passed calibration run.
- rejected: changing wording before image sensitivity is measured.
- changed: six image classes are now queued as separate batches.
- reason: isolate source-image structure as the independent variable.

### Next Exact Action

1. Poll all six batch ids until done or error.
2. Verify each saved API prompt remains no NAG/no crop-guide/no prompt enhancer/two-stage.
3. Build a contact-sheet comparison and score image sensitivity.

## 2026-05-30 Round 1A Invalidated: Image Conditioning Strength Mapping

### Current State

- active_round: Round 1A Image Sensitivity
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- comfy_status: all six queued runs completed, but invalid for scoring
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| image_id | batch_id | run_id | keep/reject | reason |
|---|---|---|---|---|
| street_depth_night | camera_lab_1780129011_9675 | 01_street_depth_night | reject | infrastructure bug: image-conditioning strength mapped incorrectly |
| front_portrait_flat | camera_lab_1780129012_8722 | 01_front_portrait_flat | reject | output reused the same generated street scene despite distinct input hash |
| side_profile_flat | camera_lab_1780129013_7008 | 01_side_profile_flat | reject | output reused the same generated street scene despite distinct input hash |
| street_depth_day | camera_lab_1780129014_4782 | 01_street_depth_day | reject | output reused the same generated street scene despite distinct input hash |
| foreground_occluder | camera_lab_1780129015_1671 | 01_foreground_occluder | reject | output reused the same generated street scene despite distinct input hash |
| full_body_flat | camera_lab_1780129016_7184 | 01_full_body_flat | reject | output reused the same generated street scene despite distinct input hash |

### Diagnosis

- each run had a distinct `source_image`, distinct resized source hash, and distinct Comfy input filename.
- saved `api_prompt.json` used the correct `LoadImage` filename and Comfy embedded the distinct image hash in output metadata.
- visual output still matched the calibration street scene across all six runs.
- root cause found in generated API: `LTXVImgToVideoInplace` nodes had `strength: 0.0` because the generic widget mapper consumed the `strength` widget when it saw the linked `bypass` widget.
- official template source values are `strength=1.0` for node `288` and `strength=0.7` for node `296`.

### Decisions Made

- kept: official local baseline and no-NAG/no-crop/no-enhancer/two-stage constraints.
- rejected: scoring these six videos as image sensitivity evidence.
- changed: patch official I2V API generation to restore `LTXVImgToVideoInplace` strengths to `1.0` and `0.7`.
- reason: image sensitivity testing is meaningless unless source image conditioning is active.

### Next Exact Action

1. Restart Camera Lab with the strength patch.
2. Re-run a one-image sanity check using `front_portrait_flat`; output must visibly follow the portrait source.
3. If sanity check passes, re-run Round 1A.

## 2026-05-30 Front Portrait Sanity Check Queued

### Current State

- active_round: image-conditioning sanity check
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_image_set: `front_portrait_flat`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- active_batch_id: `camera_lab_1780129382_3870`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| image_id | batch_id | run_id | workflow | move | prompt_level | seed | status |
|---|---|---|---|---|---|---|---|
| front_portrait_flat | camera_lab_1780129382_3870 | 01_front_portrait_sanity | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |

### Next Exact Action

1. Poll `camera_lab_1780129382_3870`.
2. Check output visually follows the portrait source.
3. If pass, re-run the six-image Round 1A sweep.

## 2026-05-30 Front Portrait Sanity Check Passed

### Current State

- active_round: image-conditioning sanity check
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_image_set: `front_portrait_flat`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704`
- active_batch_id: `camera_lab_1780129382_3870`
- comfy_status: done
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| camera_lab_1780129382_3870 | 01_front_portrait_sanity | `tasks/camera_lab_runs/camera_lab_1780129382_3870/01_front_portrait_sanity/01_front_portrait_sanity_00001_.mp4` | infrastructure pass | keep as sanity evidence | output follows portrait input; image-conditioning strengths are `1.0` and `0.7` |

### Verification

- `api_prompt.json`: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- `api_prompt.json`: two `SamplerCustomAdvanced` nodes.
- `api_prompt.json`: `LTXVImgToVideoInplace` strengths are `288=1.0`, `296=0.7`.
- `ffprobe`: video stream H.264, `1280x704`, 24 fps, 4.041667 seconds.
- `ffprobe`: audio stream AAC stereo, 48 kHz, 4.041 seconds.
- contact sheet: source portrait is preserved and visibly used.

### Decisions Made

- kept: strength patch as required for formal I2V image sensitivity.
- rejected: all previous six-image Round 1A outputs before this patch.
- changed: proceed to re-run Round 1A from scratch.
- reason: image sensitivity can now measure source-image influence.

### Next Exact Action

1. Queue six-image Round 1A again.
2. Verify source variation in the comparison sheet before scoring.
3. Commit strength-patch milestone after the rerun is validated.

## 2026-05-30 Round 1A Image Sensitivity Re-Queued After Strength Patch

### Current State

- active_round: Round 1A Image Sensitivity rerun
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| image_id | batch_id | run_id | workflow | move | prompt_level | seed | status |
|---|---|---|---|---|---|---|---|
| street_depth_night | camera_lab_1780129475_3269 | 01_street_depth_night_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| front_portrait_flat | camera_lab_1780129476_6949 | 01_front_portrait_flat_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| side_profile_flat | camera_lab_1780129477_6254 | 01_side_profile_flat_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| street_depth_day | camera_lab_1780129478_6521 | 01_street_depth_day_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| foreground_occluder | camera_lab_1780129479_7201 | 01_foreground_occluder_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |
| full_body_flat | camera_lab_1780129480_4600 | 01_full_body_flat_rerun | i2v_official_local | dolly_push_in | Level C | 1626970716 | running |

### Next Exact Action

1. Poll all six rerun batch ids until done or error.
2. Build a rerun comparison contact sheet.
3. Score image sensitivity only if the six outputs visibly reflect their different source images.

## 2026-05-30 Round 1A Image Sensitivity Rerun Completed

### Current State

- active_round: Round 1A Image Sensitivity rerun
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_prompt_level: Level C / physical push-in candidate
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all six runs
- comfy_status: done
- comparison_sheet: `tasks/camera_lab_runs/round1a_dolly_push_image_sensitivity_rerun_contact.jpg`
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| image_id | batch_id | run_id | video_path | keep/reject | reason |
|---|---|---|---|---|---|
| street_depth_night | camera_lab_1780129475_3269 | 01_street_depth_night_rerun | `tasks/camera_lab_runs/camera_lab_1780129475_3269/01_street_depth_night_rerun/01_street_depth_night_rerun_00001_.mp4` | keep | strongest real parallax, but identity/pose drift risk |
| front_portrait_flat | camera_lab_1780129476_6949 | 01_front_portrait_flat_rerun | `tasks/camera_lab_runs/camera_lab_1780129476_6949/01_front_portrait_flat_rerun/01_front_portrait_flat_rerun_00001_.mp4` | keep as identity baseline | clean push/scale and stable face, but weak parallax |
| side_profile_flat | camera_lab_1780129477_6254 | 01_side_profile_flat_rerun | `tasks/camera_lab_runs/camera_lab_1780129477_6254/01_side_profile_flat_rerun/01_side_profile_flat_rerun_00001_.mp4` | keep as failure mode | model rotates face toward camera, so motion is not pure dolly |
| street_depth_day | camera_lab_1780129478_6521 | 01_street_depth_day_rerun | `tasks/camera_lab_runs/camera_lab_1780129478_6521/01_street_depth_day_rerun/01_street_depth_day_rerun_00001_.mp4` | keep | strong push and depth, but final framing cuts head/upper body |
| foreground_occluder | camera_lab_1780129479_7201 | 01_foreground_occluder_rerun | `tasks/camera_lab_runs/camera_lab_1780129479_7201/01_foreground_occluder_rerun/01_foreground_occluder_rerun_00001_.mp4` | keep | best parallax cue; foreground edge helps motion readability |
| full_body_flat | camera_lab_1780129480_4600 | 01_full_body_flat_rerun | `tasks/camera_lab_runs/camera_lab_1780129480_4600/01_full_body_flat_rerun/01_full_body_flat_rerun_00001_.mp4` | reject for dolly | mostly crop/zoom, poor parallax, composition cuts body |

### Verification

- all six: video and audio streams present.
- all six: `1280x704`, 24 fps, about 4.04 seconds.
- all six: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all six: two `SamplerCustomAdvanced` nodes.
- all six: `LTXVImgToVideoInplace` strengths `288=1.0`, `296=0.7`.
- visual source variation: pass; each output now visibly follows its own input image.

### Provisional Scores

| image_id | direction | camera_purity | parallax | identity | composition | audio | camera_score | usable_score | note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| street_depth_night | 4 | 3 | 4 | 2 | 3 | 4 | 14 | 20 | good depth, but subject drift |
| front_portrait_flat | 4 | 4 | 1 | 4 | 4 | 4 | 13 | 21 | stable identity, weak camera evidence |
| side_profile_flat | 3 | 2 | 1 | 3 | 4 | 4 | 10 | 17 | face rotates, not pure dolly |
| street_depth_day | 5 | 4 | 4 | 3 | 2 | 4 | 15 | 22 | strong motion, bad final crop |
| foreground_occluder | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | strongest overall dolly candidate |
| full_body_flat | 3 | 3 | 0 | 2 | 2 | 4 | 8 | 14 | behaves like crop/zoom |

### Decisions Made

- kept for next prompt tests: `foreground_occluder`, `street_depth_day`, and `front_portrait_flat`.
- rejected for dolly optimization: `full_body_flat`.
- changed: side-profile image remains useful only as a failure/control case.
- reason: dolly needs either foreground/depth cues for parallax or a portrait baseline for identity stability; flat full-body images provide neither.

### Current Best Dolly Pattern

```text
Slow dolly push in. The camera moves physically forward with smooth perspective change and subtle parallax. No cut.
```

Current best seed for Dolly Push In: `1626970716`, provisional; it produced usable motion on depth/foreground images but needs seed hunt for identity stability.

### Next Exact Action

1. Commit the strength-patch and Round 1A result log.
2. Run Round 2 Dolly prompt sensitivity on `foreground_occluder` and `front_portrait_flat`.
3. Compare Level A/B/C/D wording to find the shortest prompt that preserves dolly behavior.

## 2026-05-30 Round 2 Dolly Prompt Sensitivity Queued

### Current State

- active_round: Round 2 Prompt Sensitivity
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_image_set: `foreground_occluder`, `front_portrait_flat`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Prompt Levels

| level | prompt |
|---|---|
| A | `Slow dolly push in. No cut.` |
| B | `Slow dolly push in. The camera moves physically forward, not the subject. No cut.` |
| C | `Slow dolly push in. The camera moves physically forward with visible parallax and stable subject identity. No cut.` |
| D | `Slow dolly push in. The camera moves physically forward while the subject stays naturally stable. Background and foreground shift with correct parallax. No zoom simulation, no scene change, no cut.` |

### Queued / Running

| image_id | batch_id | run_ids | workflow | move | seed | status |
|---|---|---|---|---|---|---|
| foreground_occluder | camera_lab_1780129768_9000 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | i2v_official_local | dolly_push_in | 1626970716 | running |
| front_portrait_flat | camera_lab_1780129769_5969 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | i2v_official_local | dolly_push_in | 1626970716 | running |

### Next Exact Action

1. Poll both Round 2 batches until all eight runs finish or error.
2. Build per-image prompt comparison contact sheets.
3. Pick the shortest prompt level that stays within one point of the best.

## 2026-05-30 Round 2 Dolly Prompt Sensitivity Completed

### Current State

- active_round: Round 2 Prompt Sensitivity
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_image_set: `foreground_occluder`, `front_portrait_flat`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all eight runs
- comfy_status: done
- foreground_comparison_sheet: `tasks/camera_lab_runs/round2_dolly_prompt_foreground_occluder_contact.jpg`
- portrait_comparison_sheet: `tasks/camera_lab_runs/round2_dolly_prompt_front_portrait_flat_contact.jpg`
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| image_id | batch_id | run_ids | keep/reject | reason |
|---|---|---|---|---|
| foreground_occluder | camera_lab_1780129768_9000 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | keep | all four prompts preserve strong parallax; prompt wording is less important than image structure |
| front_portrait_flat | camera_lab_1780129769_5969 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | keep | Level A drifts gaze/pose; B/C/D stabilize identity while keeping push-in |

### Verification

- all eight: video and audio streams present.
- all eight: `1280x704`, 24 fps, about 4.04 seconds.
- all eight: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all eight: two `SamplerCustomAdvanced` nodes.
- all eight: image-conditioning strengths `288=1.0`, `296=0.7`.

### Prompt Scores

Foreground/depth source:

| level | direction | camera_purity | parallax | identity | composition | audio | camera_score | usable_score | note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | already works because image has strong foreground/depth cues |
| B | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | equivalent to A, slightly clearer intent |
| C | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | no meaningful gain over B |
| D | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | no meaningful gain; longer prompt not justified |

Portrait source:

| level | direction | camera_purity | parallax | identity | composition | audio | camera_score | usable_score | note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| A | 3 | 3 | 1 | 2 | 3 | 4 | 10 | 16 | subject looks down; identity/pose changes |
| B | 4 | 4 | 1 | 4 | 4 | 4 | 13 | 21 | shortest stable wording |
| C | 4 | 4 | 1 | 4 | 4 | 4 | 13 | 21 | stable but no gain over B |
| D | 4 | 4 | 1 | 4 | 4 | 4 | 13 | 21 | stable but over-specified |

### Decisions Made

- winning default prompt for Dolly Push In:

```text
Slow dolly push in. The camera moves physically forward, not the subject. No cut.
```

- backup parallax prompt:

```text
Slow dolly push in. The camera moves physically forward with visible parallax and stable subject identity. No cut.
```

- rejected as default: Level D, because it does not improve results enough to justify the added constraints.
- rejected for portrait: Level A, because it causes avoidable identity/pose drift.
- reason: the smallest phrase that changes behavior is `physically forward, not the subject`; explicit parallax helps explain the target but did not improve these two test cases.

### Current Dolly Finding

- best image type: foreground/depth image with a real occluder or strong street geometry.
- acceptable identity baseline: front portrait, but it mostly tests controlled push/scale, not physical parallax.
- poor dolly source: flat full-body image.
- provisional best seed: `1626970716`; still needs seed hunt because street/depth identity can drift.

### Next Exact Action

1. Commit Round 2 result log.
2. Run Dolly seed hunt on `foreground_occluder` with the winning Level B prompt.
3. Confirm whether `1626970716` remains best against at least five alternate seeds.

## 2026-05-30 Round 3 Dolly Seed Hunt Queued

### Current State

- active_round: Round 3 Seed Hunt
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_image_set: `foreground_occluder`
- active_prompt_level: Level B winner
- prompt: `Slow dolly push in. The camera moves physically forward, not the subject. No cut.`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| seed | batch_id | run_id | workflow | move | status |
|---:|---|---|---|---|---|
| 1626970716 | camera_lab_1780130113_8570 | 01_seed_1626970716 | i2v_official_local | dolly_push_in | running |
| 1661903965 | camera_lab_1780130114_4764 | 01_seed_1661903965 | i2v_official_local | dolly_push_in | running |
| 1780104579 | camera_lab_1780130115_1193 | 01_seed_1780104579 | i2v_official_local | dolly_push_in | running |
| 1780115672 | camera_lab_1780130116_4354 | 01_seed_1780115672 | i2v_official_local | dolly_push_in | running |
| 123456789 | camera_lab_1780130117_2349 | 01_seed_123456789 | i2v_official_local | dolly_push_in | running |
| 987654321 | camera_lab_1780130118_2075 | 01_seed_987654321 | i2v_official_local | dolly_push_in | running |

### Next Exact Action

1. Poll all six seed batches until done or error.
2. Build seed comparison contact sheet.
3. Pick top seeds for Dolly Push In on foreground/depth images.

## 2026-05-30 Round 3 Dolly Seed Hunt Completed

### Current State

- active_round: Round 3 Seed Hunt
- active_move: Dolly Push In
- active_workflow: `i2v_official_local`
- active_image_set: `foreground_occluder`
- active_prompt_level: Level B winner
- prompt: `Slow dolly push in. The camera moves physically forward, not the subject. No cut.`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all six runs
- comfy_status: done
- comparison_sheet: `tasks/camera_lab_runs/round3_dolly_seed_foreground_contact.jpg`
- camera_lab_url: `http://127.0.0.1:8766`

### Completed Since Last Checkpoint

| seed | batch_id | run_id | video_path | keep/reject | reason |
|---:|---|---|---|---|---|
| 1626970716 | camera_lab_1780130113_8570 | 01_seed_1626970716 | `tasks/camera_lab_runs/camera_lab_1780130113_8570/01_seed_1626970716/01_seed_1626970716_00001_.mp4` | keep winner | cleanest face, strong parallax, stable composition |
| 1661903965 | camera_lab_1780130114_4764 | 01_seed_1661903965 | `tasks/camera_lab_runs/camera_lab_1780130114_4764/01_seed_1661903965/01_seed_1661903965_00001_.mp4` | reject | foreground vertical line covers face for too much of the clip |
| 1780104579 | camera_lab_1780130115_1193 | 01_seed_1780104579 | `tasks/camera_lab_runs/camera_lab_1780130115_1193/01_seed_1780104579/01_seed_1780104579_00001_.mp4` | keep backup | strong parallax, face clears after early occlusion |
| 1780115672 | camera_lab_1780130116_4354 | 01_seed_1780115672 | `tasks/camera_lab_runs/camera_lab_1780130116_4354/01_seed_1780115672/01_seed_1780115672_00001_.mp4` | reject | repeated face occlusion by foreground bar |
| 123456789 | camera_lab_1780130117_2349 | 01_seed_123456789 | `tasks/camera_lab_runs/camera_lab_1780130117_2349/01_seed_123456789/01_seed_123456789_00001_.mp4` | keep backup | usable parallax and mostly clear face; slight expression drift |
| 987654321 | camera_lab_1780130118_2075 | 01_seed_987654321 | `tasks/camera_lab_runs/camera_lab_1780130118_2075/01_seed_987654321/01_seed_987654321_00001_.mp4` | reject | foreground bar covers face in most sampled frames |

### Verification

- all six: video and audio streams present.
- all six: `1280x704`, 24 fps, about 4.04 seconds.
- all six: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all six: two `SamplerCustomAdvanced` nodes.
- all six: image-conditioning strengths `288=1.0`, `296=0.7`.

### Seed Scores

| seed | direction | camera_purity | parallax | identity | composition | audio | camera_score | usable_score | note |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1626970716 | 4 | 4 | 4 | 4 | 4 | 4 | 16 | 24 | best balance |
| 1661903965 | 4 | 4 | 4 | 2 | 2 | 4 | 14 | 20 | face occlusion |
| 1780104579 | 4 | 4 | 4 | 3 | 3 | 4 | 15 | 22 | usable backup |
| 1780115672 | 4 | 4 | 4 | 2 | 2 | 4 | 14 | 20 | face occlusion |
| 123456789 | 4 | 4 | 4 | 3 | 4 | 4 | 16 | 23 | good backup |
| 987654321 | 4 | 4 | 4 | 2 | 2 | 4 | 14 | 20 | face occlusion |

### Decisions Made

- winning seed: `1626970716`.
- backup seeds: `123456789`, `1780104579`.
- rejected seeds for foreground/depth Dolly: `1661903965`, `1780115672`, `987654321`.
- reason: for foreground-pass source images, seed choice mainly controls whether the occluder crosses the face; motion quality stays strong across seeds.

### Current Dolly Best Pattern

```text
prompt: Slow dolly push in. The camera moves physically forward, not the subject. No cut.
seed: 1626970716
best source type: foreground/depth image with a real occluder or strong street geometry
backup source type: front portrait for identity-only sanity checks
requested size: 1280x720
observed output size: 1280x704
workflow: i2v_official_local, no NAG, no crop-guide node, no prompt enhancer, two-stage sampling
```

### Next Exact Action

1. Commit seed-hunt result log.
2. Start the next move using the same sequence: image sensitivity, prompt sensitivity, seed hunt.
3. Recommended next move: `Dolly Pull Back`, because it is the inverse of the validated Dolly Push In baseline.

## 2026-05-30 All Remaining Moves Smoke Sweep Queued

### Current State

- active_round: all-move smoke sweep
- active_workflow: `i2v_official_local`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- image_set: `front_portrait_flat`, `street_depth_day`, `foreground_occluder`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Rationale

- Dolly Push In already has full image/prompt/seed coverage.
- User requested all camera moves now, so the next efficient step is a broad smoke sweep over every remaining move before spending more runs on prompt and seed search.
- Three source images were chosen to cover identity-only, street/depth, and foreground-parallax conditions.

### Queued / Running

| move | image_id | batch_id | run_id | status |
|---|---|---|---|---|
| dolly_pull_back | front_portrait_flat | camera_lab_1780150070_5583 | 01_dolly_pull_back_front_portrait_flat | running |
| dolly_pull_back | street_depth_day | camera_lab_1780150070_1332 | 01_dolly_pull_back_street_depth_day | running |
| dolly_pull_back | foreground_occluder | camera_lab_1780150071_6299 | 01_dolly_pull_back_foreground_occluder | running |
| truck_left | front_portrait_flat | camera_lab_1780150071_7773 | 01_truck_left_front_portrait_flat | running |
| truck_left | street_depth_day | camera_lab_1780150071_3630 | 01_truck_left_street_depth_day | running |
| truck_left | foreground_occluder | camera_lab_1780150072_4055 | 01_truck_left_foreground_occluder | running |
| truck_right | front_portrait_flat | camera_lab_1780150072_7085 | 01_truck_right_front_portrait_flat | running |
| truck_right | street_depth_day | camera_lab_1780150073_9767 | 01_truck_right_street_depth_day | running |
| truck_right | foreground_occluder | camera_lab_1780150073_7157 | 01_truck_right_foreground_occluder | running |
| pedestal_up | front_portrait_flat | camera_lab_1780150073_4620 | 01_pedestal_up_front_portrait_flat | running |
| pedestal_up | street_depth_day | camera_lab_1780150074_3791 | 01_pedestal_up_street_depth_day | running |
| pedestal_up | foreground_occluder | camera_lab_1780150074_2738 | 01_pedestal_up_foreground_occluder | running |
| tilt_up | front_portrait_flat | camera_lab_1780150075_9368 | 01_tilt_up_front_portrait_flat | running |
| tilt_up | street_depth_day | camera_lab_1780150075_7797 | 01_tilt_up_street_depth_day | running |
| tilt_up | foreground_occluder | camera_lab_1780150076_1119 | 01_tilt_up_foreground_occluder | running |
| pan_right | front_portrait_flat | camera_lab_1780150076_8980 | 01_pan_right_front_portrait_flat | running |
| pan_right | street_depth_day | camera_lab_1780150076_2868 | 01_pan_right_street_depth_day | running |
| pan_right | foreground_occluder | camera_lab_1780150077_3224 | 01_pan_right_foreground_occluder | running |
| roll_clockwise | front_portrait_flat | camera_lab_1780150077_6520 | 01_roll_clockwise_front_portrait_flat | running |
| roll_clockwise | street_depth_day | camera_lab_1780150078_2171 | 01_roll_clockwise_street_depth_day | running |
| roll_clockwise | foreground_occluder | camera_lab_1780150078_8246 | 01_roll_clockwise_foreground_occluder | running |
| orbit_right | front_portrait_flat | camera_lab_1780150079_8067 | 01_orbit_right_front_portrait_flat | running |
| orbit_right | street_depth_day | camera_lab_1780150079_1278 | 01_orbit_right_street_depth_day | running |
| orbit_right | foreground_occluder | camera_lab_1780150079_8849 | 01_orbit_right_foreground_occluder | running |
| foreground_pass | front_portrait_flat | camera_lab_1780150080_3019 | 01_foreground_pass_front_portrait_flat | running |
| foreground_pass | street_depth_day | camera_lab_1780150080_3750 | 01_foreground_pass_street_depth_day | running |
| foreground_pass | foreground_occluder | camera_lab_1780150081_7886 | 01_foreground_pass_foreground_occluder | running |

### Next Exact Action

1. Poll all 27 smoke batches until done or error.
2. Verify output structure: video/audio streams, no NAG, no Crop/CropGuide, no prompt enhancer, two-stage sampling, image strengths `1.0/0.7`.
3. Build one comparison sheet per move and score the best image per move.

## 2026-05-30 All Remaining Moves Smoke Sweep Completed

### Current State

- active_round: all-move smoke sweep
- active_workflow: `i2v_official_local`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all 27 runs
- image_set: `front_portrait_flat`, `street_depth_day`, `foreground_occluder`
- comfy_status: done
- full_comparison_sheet: `tasks/camera_lab_runs/all_moves_smoke_contact.jpg`
- camera_lab_url: `http://127.0.0.1:8766`

### Verification

- all 27 runs completed with video output.
- all 27 runs include video and audio streams.
- all 27 runs: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all 27 runs: two `SamplerCustomAdvanced` nodes.
- all 27 runs: image-conditioning strengths `288=1.0`, `296=0.7`.

### Per-Move Contact Sheets

| move | contact_sheet |
|---|---|
| dolly_pull_back | `tasks/camera_lab_runs/all_moves_smoke_dolly_pull_back_contact.jpg` |
| truck_left | `tasks/camera_lab_runs/all_moves_smoke_truck_left_contact.jpg` |
| truck_right | `tasks/camera_lab_runs/all_moves_smoke_truck_right_contact.jpg` |
| pedestal_up | `tasks/camera_lab_runs/all_moves_smoke_pedestal_up_contact.jpg` |
| tilt_up | `tasks/camera_lab_runs/all_moves_smoke_tilt_up_contact.jpg` |
| pan_right | `tasks/camera_lab_runs/all_moves_smoke_pan_right_contact.jpg` |
| roll_clockwise | `tasks/camera_lab_runs/all_moves_smoke_roll_clockwise_contact.jpg` |
| orbit_right | `tasks/camera_lab_runs/all_moves_smoke_orbit_right_contact.jpg` |
| foreground_pass | `tasks/camera_lab_runs/all_moves_smoke_foreground_pass_contact.jpg` |

### Smoke Results

| move | best_image | camera_score | usable_score | keep/reject | observation |
|---|---|---:|---:|---|---|
| dolly_pull_back | street_depth_day | 11 | 18 | needs prompt work | reads more like forward crop/subject scale than true pull-back; depth image still best test bed |
| truck_left | foreground_occluder | 14 | 22 | keep | lateral/parallax cue is visible; foreground source works better than portrait |
| truck_right | foreground_occluder | 13 | 21 | keep but weak | front portrait turns subject profile instead of moving camera; foreground source is most stable |
| pedestal_up | street_depth_day | 8 | 14 | needs prompt work | model crops upward/downward rather than clean vertical camera rise |
| tilt_up | street_depth_day | 10 | 17 | keep but weak | some upward reframing/reveal, but identity and crop drift |
| pan_right | street_depth_day | 11 | 18 | keep but weak | model tends to crop/slide rather than fixed-position pan; street geometry helps |
| roll_clockwise | front_portrait_flat | 12 | 20 | keep | portrait shows the clearest roll-like frame rotation; depth images become subject/scene drift |
| orbit_right | street_depth_day | 10 | 17 | needs prompt work | mostly push/slide; small viewpoint change but not enough orbit |
| foreground_pass | front_portrait_flat | 9 | 15 | reject as fake foreground | model hallucinates a passing object on portrait; real foreground source did not produce a clean pass with this prompt |

### Decisions Made

- clear next candidates: `truck_left`, `truck_right`, `roll_clockwise`.
- weak but worth tuning: `tilt_up`, `pan_right`, `dolly_pull_back`.
- needs stronger prompt/source strategy: `pedestal_up`, `orbit_right`, `foreground_pass`.
- image guidance:
  - lateral moves need `foreground_occluder` or street geometry.
  - roll works best on `front_portrait_flat`.
  - foreground pass needs a purpose-built source with a near edge/occluder; the current foreground source helps dolly but not pass-by.
- reason: broad sweep confirms that source-image structure dominates results, but prompt wording still matters for inverse/rotational moves.

### Next Exact Action

1. Commit smoke sweep result log.
2. Queue prompt sensitivity for the moves with usable smoke evidence:
   - `truck_left` on `foreground_occluder`
   - `truck_right` on `foreground_occluder`
   - `roll_clockwise` on `front_portrait_flat`
   - `tilt_up` on `street_depth_day`
   - `pan_right` on `street_depth_day`
   - `dolly_pull_back` on `street_depth_day`
3. Hold `pedestal_up`, `orbit_right`, and `foreground_pass` until a stronger prompt/source hypothesis is logged.

## 2026-05-30 Multi-Move Prompt Sensitivity Queued

### Current State

- active_round: prompt sensitivity for usable smoke moves
- active_workflow: `i2v_official_local`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| move | image_id | batch_id | run_ids | status |
|---|---|---|---|---|
| truck_left | foreground_occluder | camera_lab_1780151100_9343 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | running |
| truck_right | foreground_occluder | camera_lab_1780151101_7460 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_parallax, 04_level_d_constrained | running |
| roll_clockwise | front_portrait_flat | camera_lab_1780151102_4472 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_axis, 04_level_d_constrained | running |
| tilt_up | street_depth_day | camera_lab_1780151103_7798 | 01_level_a_minimal, 02_level_b_fixed, 03_level_c_reveal, 04_level_d_constrained | running |
| pan_right | street_depth_day | camera_lab_1780151104_6963 | 01_level_a_minimal, 02_level_b_fixed, 03_level_c_reveal, 04_level_d_constrained | running |
| dolly_pull_back | street_depth_day | camera_lab_1780151105_6409 | 01_level_a_minimal, 02_level_b_physical, 03_level_c_reveal, 04_level_d_constrained | running |

### Decisions Made

- kept: one image per move, selected from the smoke sweep best or least-bad source.
- rejected: prompt sensitivity for `pedestal_up`, `orbit_right`, and `foreground_pass` before new source/prompt hypotheses.
- reason: these three moves failed in ways that likely require a source-image change, not only prompt wording.

### Next Exact Action

1. Poll all six prompt-sensitivity batches until done or error.
2. Build one prompt comparison sheet per move.
3. Record each move's shortest usable prompt and remaining failure mode.

## 2026-05-30 Multi-Move Prompt Sensitivity Completed

### Current State

- active_round: prompt sensitivity for usable smoke moves
- active_workflow: `i2v_official_local`
- active_seed_set: `1626970716`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all 24 runs
- comfy_status: done
- camera_lab_url: `http://127.0.0.1:8766`

### Verification

- all 24 runs completed with video output.
- all 24 runs include video and audio streams.
- all 24 runs: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all 24 runs: two `SamplerCustomAdvanced` nodes.

### Prompt Comparison Sheets

| move | batch_id | contact_sheet |
|---|---|---|
| truck_left | camera_lab_1780151100_9343 | `tasks/camera_lab_runs/prompt_sensitivity_truck_left_contact.jpg` |
| truck_right | camera_lab_1780151101_7460 | `tasks/camera_lab_runs/prompt_sensitivity_truck_right_contact.jpg` |
| roll_clockwise | camera_lab_1780151102_4472 | `tasks/camera_lab_runs/prompt_sensitivity_roll_clockwise_contact.jpg` |
| tilt_up | camera_lab_1780151103_7798 | `tasks/camera_lab_runs/prompt_sensitivity_tilt_up_contact.jpg` |
| pan_right | camera_lab_1780151104_6963 | `tasks/camera_lab_runs/prompt_sensitivity_pan_right_contact.jpg` |
| dolly_pull_back | camera_lab_1780151105_6409 | `tasks/camera_lab_runs/prompt_sensitivity_dolly_pull_back_contact.jpg` |

### Prompt Sensitivity Results

| move | winner_level | winner_prompt | camera_score | usable_score | decision |
|---|---|---|---:|---:|---|
| truck_left | A | `Smooth truck left. No cut.` | 15 | 23 | keep; foreground/depth source carries the move, extra constraints can make the model ignore the source |
| truck_right | A | `Smooth truck right. No cut.` | 15 | 23 | keep; short prompt is strongest, B/D over-constrain and cause crop/identity drift |
| roll_clockwise | C | `Smooth clockwise camera roll. The frame rotates around the lens axis while the subject remains the same. No cut.` | 13 | 21 | keep; phrase `around the lens axis` is necessary to avoid scene drift |
| tilt_up | B | `Smooth tilt up. The camera pivots upward from a fixed position, not sliding. No cut.` | 10 | 17 | weak; B is least bad but still reads as reframing/zoom more than clean tilt |
| pan_right | B | `Smooth pan right. The camera rotates right from a fixed position, not sliding sideways. No cut.` | 10 | 17 | weak; still crops/slides, needs stronger pan-specific source or prompt |
| dolly_pull_back | C | `Slow dolly pull back. The camera moves physically backward, revealing more of the scene while the subject stays centered. No cut.` | 12 | 19 | weak; C is best among tested, but direction is ambiguous versus push/scale |

### Decisions Made

- ready for seed hunt:
  - `truck_left` with Level A on `foreground_occluder`.
  - `truck_right` with Level A on `foreground_occluder`.
  - `roll_clockwise` with Level C on `front_portrait_flat`.
- not ready for seed hunt:
  - `tilt_up`, `pan_right`, `dolly_pull_back`; prompt improved slightly but not enough for reliable camera interpretation.
- still held:
  - `pedestal_up`, `orbit_right`, `foreground_pass`; they need source/prompt redesign before deeper testing.

### Updated Working Prompt Set

```text
truck_left:
  Smooth truck left. No cut.

truck_right:
  Smooth truck right. No cut.

roll_clockwise:
  Smooth clockwise camera roll. The frame rotates around the lens axis while the subject remains the same. No cut.

tilt_up_candidate:
  Smooth tilt up. The camera pivots upward from a fixed position, not sliding. No cut.

pan_right_candidate:
  Smooth pan right. The camera rotates right from a fixed position, not sliding sideways. No cut.

dolly_pull_back_candidate:
  Slow dolly pull back. The camera moves physically backward, revealing more of the scene while the subject stays centered. No cut.
```

### Next Exact Action

1. Commit prompt-sensitivity result log.
2. Queue seed hunts for `truck_left`, `truck_right`, and `roll_clockwise`.
3. For weak/held moves, build or select better source images before additional prompt runs.

## 2026-05-30 Multi-Move Seed Hunts Queued

### Current State

- active_round: seed hunts for validated moves
- active_workflow: `i2v_official_local`
- requested_size: `1280x720`
- comfy_status: running
- camera_lab_url: `http://127.0.0.1:8766`

### Queued / Running

| move | image_id | prompt_level | seed | batch_id | run_id | status |
|---|---|---|---:|---|---|---|
| truck_left | foreground_occluder | Level A winner | 1626970716 | camera_lab_1780152095_6302 | 01_truck_left_seed_1626970716 | running |
| truck_left | foreground_occluder | Level A winner | 1661903965 | camera_lab_1780152096_1012 | 01_truck_left_seed_1661903965 | running |
| truck_left | foreground_occluder | Level A winner | 1780104579 | camera_lab_1780152096_7687 | 01_truck_left_seed_1780104579 | running |
| truck_left | foreground_occluder | Level A winner | 1780115672 | camera_lab_1780152097_2648 | 01_truck_left_seed_1780115672 | running |
| truck_left | foreground_occluder | Level A winner | 123456789 | camera_lab_1780152097_6178 | 01_truck_left_seed_123456789 | running |
| truck_left | foreground_occluder | Level A winner | 987654321 | camera_lab_1780152098_7933 | 01_truck_left_seed_987654321 | running |
| truck_right | foreground_occluder | Level A winner | 1626970716 | camera_lab_1780152098_4592 | 01_truck_right_seed_1626970716 | running |
| truck_right | foreground_occluder | Level A winner | 1661903965 | camera_lab_1780152099_4394 | 01_truck_right_seed_1661903965 | running |
| truck_right | foreground_occluder | Level A winner | 1780104579 | camera_lab_1780152099_2175 | 01_truck_right_seed_1780104579 | running |
| truck_right | foreground_occluder | Level A winner | 1780115672 | camera_lab_1780152100_8971 | 01_truck_right_seed_1780115672 | running |
| truck_right | foreground_occluder | Level A winner | 123456789 | camera_lab_1780152100_1751 | 01_truck_right_seed_123456789 | running |
| truck_right | foreground_occluder | Level A winner | 987654321 | camera_lab_1780152101_1191 | 01_truck_right_seed_987654321 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 1626970716 | camera_lab_1780152101_5080 | 01_roll_clockwise_seed_1626970716 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 1661903965 | camera_lab_1780152102_6580 | 01_roll_clockwise_seed_1661903965 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 1780104579 | camera_lab_1780152102_8856 | 01_roll_clockwise_seed_1780104579 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 1780115672 | camera_lab_1780152103_1095 | 01_roll_clockwise_seed_1780115672 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 123456789 | camera_lab_1780152103_2948 | 01_roll_clockwise_seed_123456789 | running |
| roll_clockwise | front_portrait_flat | Level C winner | 987654321 | camera_lab_1780152104_3468 | 01_roll_clockwise_seed_987654321 | running |

### Next Exact Action

1. Poll all 18 seed batches until done or error.
2. Build one seed comparison sheet per move.
3. Pick best three seeds for each move.

## 2026-05-30 Multi-Move Seed Hunts Completed

### Current State

- active_round: seed hunts for validated moves
- active_workflow: `i2v_official_local`
- requested_size: `1280x720`
- actual_output_size: `1280x704` for all 18 runs
- comfy_status: done
- camera_lab_url: `http://127.0.0.1:8766`

### Verification

- all 18 runs completed with video output.
- all 18 runs include video and audio streams.
- all 18 runs: no NAG nodes, no Crop/CropGuide nodes, no prompt enhancer nodes.
- all 18 runs: two `SamplerCustomAdvanced` nodes.

### Seed Comparison Sheets

| move | contact_sheet |
|---|---|
| truck_left | `tasks/camera_lab_runs/seed_hunt_truck_left_contact.jpg` |
| truck_right | `tasks/camera_lab_runs/seed_hunt_truck_right_contact.jpg` |
| roll_clockwise | `tasks/camera_lab_runs/seed_hunt_roll_clockwise_contact.jpg` |

### Seed Hunt Results

| move | seed | camera_score | usable_score | keep/reject | note |
|---|---:|---:|---:|---|---|
| truck_left | 1626970716 | 15 | 23 | winner | cleanest face and clear foreground side parallax |
| truck_left | 1661903965 | 13 | 18 | reject | foreground vertical line covers face |
| truck_left | 1780104579 | 13 | 18 | reject | foreground vertical line covers face |
| truck_left | 1780115672 | 13 | 18 | reject | foreground vertical line covers face |
| truck_left | 123456789 | 13 | 18 | weak backup | usable motion but face occlusion risk |
| truck_left | 987654321 | 13 | 18 | reject | foreground vertical line covers face |
| truck_right | 1626970716 | 15 | 23 | winner | cleanest face and clear foreground side parallax |
| truck_right | 1661903965 | 13 | 18 | reject | foreground vertical line covers face |
| truck_right | 1780104579 | 13 | 18 | reject | foreground vertical line covers face |
| truck_right | 1780115672 | 13 | 18 | reject | foreground vertical line covers face |
| truck_right | 123456789 | 13 | 18 | weak backup | usable motion but face occlusion risk |
| truck_right | 987654321 | 13 | 18 | reject | foreground vertical line covers face |
| roll_clockwise | 1626970716 | 13 | 21 | winner | cleanest clockwise frame roll with stable identity |
| roll_clockwise | 1661903965 | 12 | 18 | directional | rotates viewpoint too much; becomes side portrait |
| roll_clockwise | 1780104579 | 12 | 17 | reject | turns into profile/back-of-head, not pure roll |
| roll_clockwise | 1780115672 | 12 | 19 | weak backup | some roll, but eyes close and identity drifts |
| roll_clockwise | 123456789 | 11 | 20 | identity-safe backup | face stable, roll effect weak |
| roll_clockwise | 987654321 | 12 | 18 | reject | becomes side portrait / viewpoint change |

### Current Best Patterns

```text
truck_left:
  prompt: Smooth truck left. No cut.
  seed: 1626970716
  source: foreground/depth image with visible near edge

truck_right:
  prompt: Smooth truck right. No cut.
  seed: 1626970716
  source: foreground/depth image with visible near edge

roll_clockwise:
  prompt: Smooth clockwise camera roll. The frame rotates around the lens axis while the subject remains the same. No cut.
  seed: 1626970716
  source: front portrait / low-depth identity image
  backup seed: 123456789 for identity-safe but weaker roll
```

### Decisions Made

- `1626970716` is currently the best shared seed for Dolly Push In, Truck Left, Truck Right, and Roll Clockwise.
- For foreground/depth lateral movement, seed choice mainly controls whether foreground occluders cross the subject's face.
- For roll, seed choice controls whether the model performs true frame roll or turns the subject/viewpoint.
- reason: the same seed that worked for Dolly also avoids the most damaging occluder placement in lateral moves.

### Next Exact Action

1. Commit seed-hunt result log.
2. Work on the unresolved moves with new hypotheses:
   - `dolly_pull_back`: needs explicit "subject gets smaller / reveal more background" and possibly wider source framing.
   - `tilt_up`: needs source with vertical reveal target above subject.
   - `pan_right`: needs wide source with clear offscreen/right-side reveal.
   - `pedestal_up`: needs vertical-line/interior source and no dolly wording.
   - `orbit_right`: needs subject with visible side geometry or side-view source.
   - `foreground_pass`: needs a purpose-built source with a large near foreground object already in frame.

## 2026-05-30 Review Correction: All-Move Conclusions

### Why This Review Was Needed

After re-checking the contact sheets, the previous Truck Left / Truck Right wording was too optimistic. The videos show lateral parallax, but the tested prompts do not clearly prove left-vs-right direction polarity. The foreground/depth source and shared seed create similar-looking side movement for both directions.

### Corrected Confidence Levels

| move | corrected_status | best_current_prompt | best_current_seed | source_dependency | review_note |
|---|---|---|---:|---|---|
| dolly_push_in | validated | `Slow dolly push in. The camera moves physically forward, not the subject. No cut.` | 1626970716 | needs depth / foreground | strongest tested result; still watch for crop-like push, but direction is readable |
| dolly_pull_back | not validated | `Smooth dolly pull back. The camera moves backward and reveals more of the scene. No cut.` | 1626970716 | needs wider source | outputs are ambiguous and often look like crop/zoom, not a true pull-back |
| truck_left | partially validated | `Smooth truck left. No cut.` | 1626970716 | needs foreground/depth | lateral parallax works, but left direction is not proven against truck_right |
| truck_right | partially validated | `Smooth truck right. No cut.` | 1626970716 | needs foreground/depth | lateral parallax works, but right direction is not proven against truck_left |
| pedestal_up | not validated | `Smooth pedestal up. The camera rises vertically. No cut.` | unconfirmed | needs vertical architecture/interior | outputs read as crop/zoom/reframe, not clean vertical camera rise |
| tilt_up | not validated | `Smooth tilt up. The camera tilts upward in place. No cut.` | unconfirmed | needs tall source with target above | variants reframe/zoom and change subject scale; not a fixed-position tilt |
| pan_right | not validated | `Smooth pan right. The camera pivots right in place. No cut.` | unconfirmed | needs wide panoramic source | outputs slide/crop the frame rather than clean fixed-position pan |
| roll_clockwise | weak validated | `Smooth clockwise camera roll. The frame rotates around the lens axis while the subject remains the same. No cut.` | 1626970716 | front portrait works best | best seed gives mild clockwise roll; many seeds become viewpoint rotation instead |
| orbit_right | not validated | `Smooth orbit right around the subject. No cut.` | unconfirmed | needs 3/4 or side-view geometry | current smoke output looks like push/slide, not an orbit |
| foreground_pass | not validated | `Foreground object passes close to the camera. No cut.` | unconfirmed | needs real near object in source | current source either hallucinates an object or does not create a clean pass |

### Corrected Working Conclusion

Only `dolly_push_in` is strongly validated in the current official I2V baseline. `roll_clockwise` is usable but mild and seed-sensitive. `truck_left` and `truck_right` should be described as lateral parallax candidates, not as directionally validated moves. The remaining moves need new source images designed for that camera action before prompt/seed conclusions are trustworthy.

### Next Exact Action

1. Create an asymmetric left/right source with visible markers on both sides, then retest `truck_left` vs `truck_right` with the same seed set.
2. Create move-specific source images:
   - wide room / street for `dolly_pull_back` and `pan_right`
   - tall vertical scene for `pedestal_up` and `tilt_up`
   - 3/4 subject or side geometry for `orbit_right`
   - near foreground object already in-frame for `foreground_pass`
3. Keep `dolly_push_in` and `roll_clockwise` as the only current prompt+seed patterns suitable for a confident demo.

## 2026-05-30 Avatar Source Fix Sweep Completed

### Setup

- active_workflow: `i2v_official_local`
- comfy_url: `http://127.0.0.1:8000`
- camera_lab_url: `http://127.0.0.1:8766`
- requested_size: `1280x720`
- actual_output: video + audio present for all 8 completed runs
- seed: `1626970716`
- constraints: no NAG, no Crop/CropGuide, no prompt enhancer, two-stage official sampling
- source policy correction: all test source images use the Xiaomei avatar as the main subject, but prompts do not say `Xiaomei`; prompts only say `portrait` / `subject` to avoid identity-token bias.

### Generated Source Images

Generated by `tools/generate_camera_control_test_sources.py`.

| source | intended_moves | note |
|---|---|---|
| `tasks/camera_control_source_tests/sources/wide_depth_room_pullback_pan.png` | `dolly_pull_back`, `pan_right` | avatar portrait in a wide depth-room layout |
| `tasks/camera_control_source_tests/sources/vertical_tower_pedestal_tilt.png` | `pedestal_up`, `tilt_up` | avatar portrait under a tall vertical structure |
| `tasks/camera_control_source_tests/sources/asymmetric_truck_direction.png` | `truck_left`, `truck_right` | avatar portrait between asymmetric red/blue side markers |
| `tasks/camera_control_source_tests/sources/three_quarter_orbit_subject.png` | `orbit_right` | avatar portrait with curved floor/orbit geometry |
| `tasks/camera_control_source_tests/sources/near_foreground_pass.png` | `foreground_pass` | avatar portrait with near dark foreground bars already in frame |

### Run Manifest

Recoverable manifest: `tasks/camera_control_source_tests/source_fix_i2v_runs.json`

| move | batch_id | contact_sheet |
|---|---|---|
| dolly_pull_back | `camera_lab_1780157520_2071` | `tasks/camera_lab_runs/camera_lab_1780157520_2071/01_dolly_pull_back_source_fix/contact.jpg` |
| pan_right | `camera_lab_1780157520_9616` | `tasks/camera_lab_runs/camera_lab_1780157520_9616/01_pan_right_source_fix/contact.jpg` |
| pedestal_up | `camera_lab_1780157521_4173` | `tasks/camera_lab_runs/camera_lab_1780157521_4173/01_pedestal_up_source_fix/contact.jpg` |
| tilt_up | `camera_lab_1780157521_4427` | `tasks/camera_lab_runs/camera_lab_1780157521_4427/01_tilt_up_source_fix/contact.jpg` |
| truck_left | `camera_lab_1780157522_9263` | `tasks/camera_lab_runs/camera_lab_1780157522_9263/01_truck_left_source_fix/contact.jpg` |
| truck_right | `camera_lab_1780157522_2299` | `tasks/camera_lab_runs/camera_lab_1780157522_2299/01_truck_right_source_fix/contact.jpg` |
| orbit_right | `camera_lab_1780157523_3093` | `tasks/camera_lab_runs/camera_lab_1780157523_3093/01_orbit_right_source_fix/contact.jpg` |
| foreground_pass | `camera_lab_1780157523_7218` | `tasks/camera_lab_runs/camera_lab_1780157523_7218/01_foreground_pass_source_fix/contact.jpg` |

### Visual Review Results

| move | status_after_avatar_source_fix | review_note |
|---|---|---|
| dolly_pull_back | reject | wide source did not fix direction; output reads as push-in / subject grows larger over time, so pull-back remains unvalidated |
| pan_right | reject | source improves depth readability, but motion still reads as slide/scale rather than fixed-position pan |
| pedestal_up | reject | vertical source caused diagram/arrow artifacts and lost the portrait; not a clean vertical camera rise |
| tilt_up | reject | model hallucinated a new full-body figure and changed identity/scene; not usable as tilt-up evidence |
| truck_left | partial | asymmetric markers improve lateral parallax visibility, but left/right polarity is still not cleanly proven |
| truck_right | partial | asymmetric markers improve lateral parallax visibility, but output remains too similar to truck_left for a confident direction claim |
| orbit_right | reject | orbit guide marks remain in frame, but the portrait stays flat/front-facing; no true viewpoint orbit |
| foreground_pass | partial | near foreground object produces a real pass/occlusion event, but occlusion is heavy and composition is rough; this validates source strategy more than final quality |

### Corrected Lesson

Move-specific source structure matters, but source images must look like plausible scenes, not diagrams. Arrows, orbit marks, and instructional geometry become visible artifacts or even new generated objects. For the next round, use the Xiaomei avatar inside realistic scene-like sources: a real tall hallway/building for tilt/pedestal, a real room/street with asymmetric foreground objects for truck/pan, and a real near object for foreground pass.

## 2026-05-30 Real Avatar Source Sweep Completed

### Setup

- active_workflow: `i2v_official_local`
- comfy_url: `http://127.0.0.1:8000`
- camera_lab_url: `http://127.0.0.1:8766`
- requested_size: `1280x720`
- output_streams: all 6 final runs have video + audio streams
- seed: `1626970716`
- prompt policy: no `Xiaomei` token in prompts; prompts use `portrait` / `subject`
- source policy: Xiaomei avatar is the main subject, embedded as a framed portrait in scene-like environments.

### Source Iteration Note

The first real-source pass still had a faint duplicate Xiaomei-like person in the background, and the model often followed that background figure instead of the avatar portrait. That polluted manifest was preserved as:

`tasks/camera_control_real_source_tests/real_source_i2v_runs_v1_polluted_background.json`

The final pass regenerated the sources with the center background subject fully masked by a dark display/backing panel before rerunning the six tests.

### Final Run Manifest

Recoverable manifest: `tasks/camera_control_real_source_tests/real_source_i2v_runs.json`

| move | batch_id | source | contact_sheet |
|---|---|---|---|
| truck_left | `camera_lab_1780161664_1314` | `real_avatar_truck_asymmetric.png` | `tasks/camera_lab_runs/camera_lab_1780161664_1314/01_truck_left_real_source/contact.jpg` |
| truck_right | `camera_lab_1780161664_2503` | `real_avatar_truck_asymmetric.png` | `tasks/camera_lab_runs/camera_lab_1780161664_2503/01_truck_right_real_source/contact.jpg` |
| foreground_pass | `camera_lab_1780161665_5092` | `real_avatar_near_foreground.png` | `tasks/camera_lab_runs/camera_lab_1780161665_5092/01_foreground_pass_real_source/contact.jpg` |
| pan_right | `camera_lab_1780161666_7264` | `real_avatar_wide_room_reveal.png` | `tasks/camera_lab_runs/camera_lab_1780161666_7264/01_pan_right_real_source/contact.jpg` |
| dolly_pull_back | `camera_lab_1780161666_4192` | `real_avatar_wide_room_reveal.png` | `tasks/camera_lab_runs/camera_lab_1780161666_4192/01_dolly_pull_back_real_source/contact.jpg` |
| tilt_up | `camera_lab_1780161667_7456` | `real_avatar_vertical_lobby.png` | `tasks/camera_lab_runs/camera_lab_1780161667_7456/01_tilt_up_real_source/contact.jpg` |

### Visual Review Results

| move | status_after_real_source_fix | review_note |
|---|---|---|
| truck_left | reject | source cleaned up, but output changes the portrait into a different male-looking framed subject; not identity-safe |
| truck_right | partial / best candidate | portrait remains recognizable and lateral foreground/background parallax is visible; direction is more readable than prior rounds, worth seed hunt |
| foreground_pass | reject | foreground occlusion appears, but the model follows a full-body person in the scene instead of preserving the portrait subject |
| pan_right | partial | portrait stays stable and the scene slides/reframes slightly; still weak as a fixed-position pan, but cleaner than previous attempts |
| dolly_pull_back | reject | still behaves like push-in/scale-up; the portrait grows larger instead of shrinking/revealing space |
| tilt_up | partial | vertical reveal direction is finally readable; the camera tilts up toward buildings, but the portrait leaves frame, so it is a directional test, not a usable portrait shot |

### Updated Best Next Step

Run seed hunts only for `truck_right`, and optionally `pan_right` / `tilt_up` if the goal is direction sensitivity rather than final usable clip quality. Do not seed-hunt `dolly_pull_back` yet; the source/prompt pair repeatedly produces the opposite motion. For `foreground_pass`, use a source where the portrait is the only human-like subject and the foreground object is less dominant.

## 2026-05-30 FLF Image2 Tail-Frame Sweep Completed

### Setup

- active_workflow: `flf_sfx_extendcrop`
- comfy_url: `http://127.0.0.1:8000`
- camera_lab_url: `http://127.0.0.1:8766`
- requested_size: `1280x720`
- output_streams: all 10 runs have video + audio streams
- seed: `1626970716`
- start_frame: `assets/references/xiaomei_i2v_camera_test_street.png`
- end_frame_policy: image2 generated move-specific final frames from the same avatar/street shot
- prompt_policy: intentionally short; only the move name plus `Match the last frame.`

### Decision Record

This round changed the test from I2V-only prompt steering to FLF start/end-frame steering. The hypothesis was that several weak moves were failing because the model had no concrete target composition. Image2 tail frames were generated first, then FLF was asked to connect the original frame to each target. The prompt was kept short to test whether the final frame, not verbose prompt wording, carries the motion.

Tail-frame overview: `tasks/camera_control_flf_image2/tail_frames_overview.jpg`

Result overview: `tasks/camera_control_flf_image2/flf_image2_result_overview.jpg`

Recoverable manifest: `tasks/camera_control_flf_image2/flf_image2_runs.json`

Runner script: `tools/run_camera_control_flf_image2_sweep.py`

### Run Manifest

| move | prompt | batch_id | contact_sheet |
|---|---|---|---|
| dolly_push_in | `Dolly in. Match the last frame.` | `camera_lab_1780164222_2545` | `tasks/camera_lab_runs/camera_lab_1780164222_2545/01_dolly_push_in_flf_image2_short/contact.jpg` |
| dolly_pull_back | `Dolly back. Match the last frame.` | `camera_lab_1780164223_9164` | `tasks/camera_lab_runs/camera_lab_1780164223_9164/01_dolly_pull_back_flf_image2_short/contact.jpg` |
| truck_left | `Truck left. Match the last frame.` | `camera_lab_1780164223_9491` | `tasks/camera_lab_runs/camera_lab_1780164223_9491/01_truck_left_flf_image2_short/contact.jpg` |
| truck_right | `Truck right. Match the last frame.` | `camera_lab_1780164224_3020` | `tasks/camera_lab_runs/camera_lab_1780164224_3020/01_truck_right_flf_image2_short/contact.jpg` |
| pedestal_up | `Pedestal up. Match the last frame.` | `camera_lab_1780164224_8340` | `tasks/camera_lab_runs/camera_lab_1780164224_8340/01_pedestal_up_flf_image2_short/contact.jpg` |
| tilt_up | `Tilt up. Match the last frame.` | `camera_lab_1780164225_7371` | `tasks/camera_lab_runs/camera_lab_1780164225_7371/01_tilt_up_flf_image2_short/contact.jpg` |
| pan_right | `Pan right. Match the last frame.` | `camera_lab_1780164225_3330` | `tasks/camera_lab_runs/camera_lab_1780164225_3330/01_pan_right_flf_image2_short/contact.jpg` |
| roll_clockwise | `Roll clockwise. Match the last frame.` | `camera_lab_1780164226_5190` | `tasks/camera_lab_runs/camera_lab_1780164226_5190/01_roll_clockwise_flf_image2_short/contact.jpg` |
| orbit_right | `Orbit right. Match the last frame.` | `camera_lab_1780164227_9577` | `tasks/camera_lab_runs/camera_lab_1780164227_9577/01_orbit_right_flf_image2_short/contact.jpg` |
| foreground_pass | `Foreground pass. Match the last frame.` | `camera_lab_1780164227_6357` | `tasks/camera_lab_runs/camera_lab_1780164227_6357/01_foreground_pass_flf_image2_short/contact.jpg` |

### Visual Review Results

| move | status_after_flf_image2 | review_note |
|---|---|---|
| dolly_push_in | keep | strongest FLF result; subject grows and target close framing is followed cleanly |
| dolly_pull_back | keep | better than prior I2V tests; subject recedes and more environment is revealed |
| truck_left | partial | lateral composition changes, but it still reads partly as reframing/crop; left polarity is not cleanly proven |
| truck_right | partial | similar to truck_left; useful for lateral sensitivity tests, not yet a confident direction demo |
| pedestal_up | partial | vertical displacement is visible, but it behaves more like a reframed high-angle composition than a clean camera rise |
| tilt_up | keep as direction test | upward reveal is clear; subject can become secondary, so it is better for architecture/vertical scene tests than portrait preservation |
| pan_right | keep | right-side scene reveal is readable and more stable than I2V-only pan tests |
| roll_clockwise | keep | clockwise roll is clearly visible and cleaner than prior I2V roll |
| orbit_right | partial | target frame adds some viewpoint/framing change, but it still does not prove a true orbit around the subject |
| foreground_pass | keep | near foreground occlusion/pass is visible while the avatar remains readable enough for a demo candidate |

### Updated Lesson

FLF with image2-generated tail frames is the first setup where `dolly_pull_back`, `pan_right`, `roll_clockwise`, and `foreground_pass` become demo candidates from the same avatar source. It does not fully solve true 3D camera semantics: `truck_left`, `truck_right`, `pedestal_up`, and `orbit_right` still need stronger source geometry or multiple tail-frame attempts. The short prompt pattern is viable for FLF: `<move>. Match the last frame.` is enough when the final frame contains the desired composition.

## 2026-05-30 I2V Chinese Prompt Sweep Completed

### Setup

- active_workflow: `i2v_official_local`
- comfy_url: `http://127.0.0.1:8000`
- camera_lab_url: `http://127.0.0.1:8766`
- requested_size: `1280x720`
- output_streams: all 10 runs have video + audio streams
- seed: `1626970716`
- source_frame: `assets/references/xiaomei_i2v_camera_test_street.png`
- prompt_policy: Chinese short prompts only; no environment, no identity token, no verbose physical constraints

### Decision Record

This round tested whether LTX 2.3 I2V responds better to Chinese camera-language prompts than to the prior English short prompts. The test kept the same source image, seed, workflow, size, and duration. Only the prompt language changed.

Recoverable manifest: `tasks/camera_control_i2v_chinese_prompts/i2v_chinese_prompt_runs.json`

Result overview: `tasks/camera_control_i2v_chinese_prompts/i2v_chinese_prompt_result_overview.jpg`

Runner script: `tools/run_camera_control_i2v_chinese_prompt_sweep.py`

### Run Manifest

| move | Chinese prompt | batch_id | contact_sheet |
|---|---|---|---|
| dolly_push_in | `镜头缓慢向前推进。不要切镜。` | `camera_lab_1780166793_7949` | `tasks/camera_lab_runs/camera_lab_1780166793_7949/01_dolly_push_in_i2v_cn_short/contact.jpg` |
| dolly_pull_back | `镜头缓慢向后拉远。不要切镜。` | `camera_lab_1780166794_8537` | `tasks/camera_lab_runs/camera_lab_1780166794_8537/01_dolly_pull_back_i2v_cn_short/contact.jpg` |
| truck_left | `镜头平稳向左横移。不要切镜。` | `camera_lab_1780166794_4765` | `tasks/camera_lab_runs/camera_lab_1780166794_4765/01_truck_left_i2v_cn_short/contact.jpg` |
| truck_right | `镜头平稳向右横移。不要切镜。` | `camera_lab_1780166795_6864` | `tasks/camera_lab_runs/camera_lab_1780166795_6864/01_truck_right_i2v_cn_short/contact.jpg` |
| pedestal_up | `镜头平稳向上升起。不要切镜。` | `camera_lab_1780166795_1127` | `tasks/camera_lab_runs/camera_lab_1780166795_1127/01_pedestal_up_i2v_cn_short/contact.jpg` |
| tilt_up | `镜头固定位置向上仰拍。不要切镜。` | `camera_lab_1780166796_2296` | `tasks/camera_lab_runs/camera_lab_1780166796_2296/01_tilt_up_i2v_cn_short/contact.jpg` |
| pan_right | `镜头固定位置向右平摇。不要切镜。` | `camera_lab_1780166796_1445` | `tasks/camera_lab_runs/camera_lab_1780166796_1445/01_pan_right_i2v_cn_short/contact.jpg` |
| roll_clockwise | `镜头顺时针滚转。不要切镜。` | `camera_lab_1780166797_9821` | `tasks/camera_lab_runs/camera_lab_1780166797_9821/01_roll_clockwise_i2v_cn_short/contact.jpg` |
| orbit_right | `镜头围绕主体向右轻微环绕。不要切镜。` | `camera_lab_1780166797_5877` | `tasks/camera_lab_runs/camera_lab_1780166797_5877/01_orbit_right_i2v_cn_short/contact.jpg` |
| foreground_pass | `镜头横向移动，近处前景从画面边缘掠过。不要切镜。` | `camera_lab_1780166798_9239` | `tasks/camera_lab_runs/camera_lab_1780166798_9239/01_foreground_pass_i2v_cn_short/contact.jpg` |

### Visual Review Results

| move | status_after_cn_i2v | review_note |
|---|---|---|
| dolly_push_in | weak / partial | slight forward/framing drift, but weaker than prior English I2V and much weaker than FLF image2 |
| dolly_pull_back | reject | does not clearly pull back; mostly stable framing |
| truck_left | reject | no clean leftward camera truck; reads as minor drift |
| truck_right | partial | some rightward subject/framing change, but not clean physical truck |
| pedestal_up | reject | no clear vertical camera rise |
| tilt_up | partial | mild upward/framing change, but not a strong tilt |
| pan_right | partial | rightward reveal/profile change appears, but reads like subject/framing drift more than fixed-position pan |
| roll_clockwise | reject | Chinese prompt did not produce a meaningful roll; English/FLF remain better |
| orbit_right | reject | no true orbit; mostly stable frontal shot |
| foreground_pass | reject | no reliable foreground pass; end looks like subject/framing change |

### Updated Lesson

Chinese prompts are accepted by the pipeline, but they do not improve I2V camera control in this setup. For LTX 2.3 I2V, prompt language is less important than source geometry and first/last-frame constraints. Keep Chinese prompts as a viewer-facing explanation option, not as the best control strategy. The strongest route remains FLF with image2-generated tail frames.

## 2026-05-30 Two-Segment FLF Multi-Keyframe Probe Completed

### Setup

- active_workflow: `flf_sfx_extendcrop`
- strategy: emulate first-middle-last control by running two FLF segments, then stitching them
- comfy_url: `http://127.0.0.1:8000`
- camera_lab_url: `http://127.0.0.1:8766`
- requested_size: `1280x720`
- segment_duration: `2s + 2s`
- output_streams: all 3 stitched videos have video + audio streams
- base_seed: `1626970716`; segment 2 uses `1626970717`
- start_frame: `assets/references/xiaomei_i2v_camera_test_street.png`

### Decision Record

No local official first-middle-last LTX template was found quickly enough to rely on it. To test the core idea without adding new dependencies, this probe used the existing FLF workflow twice per move:

`start -> image2 middle keyframe -> image2 tail frame`

The goal was to see whether a middle keyframe makes complex moves harder to ignore than a single first/last pair.

Middle keyframe overview: `tasks/camera_control_multikey_flf/middle_keyframes_overview.jpg`

Stitched result overview: `tasks/camera_control_multikey_flf/multikey_flf_stitched_overview.jpg`

Recoverable manifest: `tasks/camera_control_multikey_flf/multikey_flf_probe_runs.json`

Runner script: `tools/run_camera_control_multikey_flf_probe.py`

### Generated Middle Keyframes

| move | middle_keyframe | note |
|---|---|---|
| orbit_right | `tasks/camera_control_multikey_flf/keyframes/orbit_right_middle_image2.png` | subject becomes more side-facing; useful for forcing viewpoint change |
| truck_right | `tasks/camera_control_multikey_flf/keyframes/truck_right_middle_image2.png` | subject shifts left with stronger railing/storefront parallax |
| foreground_pass | `tasks/camera_control_multikey_flf/keyframes/foreground_pass_middle_image2.png` | near dark foreground frame enters without fully covering face |

### Stitched Outputs

| move | stitched_video | stitched_contact |
|---|---|---|
| orbit_right | `tasks/camera_control_multikey_flf/stitched/orbit_right/orbit_right_two_segment_flf.mp4` | `tasks/camera_control_multikey_flf/stitched/orbit_right/contact.jpg` |
| truck_right | `tasks/camera_control_multikey_flf/stitched/truck_right/truck_right_two_segment_flf.mp4` | `tasks/camera_control_multikey_flf/stitched/truck_right/contact.jpg` |
| foreground_pass | `tasks/camera_control_multikey_flf/stitched/foreground_pass/foreground_pass_two_segment_flf.mp4` | `tasks/camera_control_multikey_flf/stitched/foreground_pass/contact.jpg` |

### Visual Review Results

| move | status_after_two_segment_flf | review_note |
|---|---|---|
| orbit_right | partial / improved direction | middle keyframe makes the viewpoint change much more obvious than I2V and single-FLF orbit, but the result is still more like staged pose/viewpoint interpolation than a smooth physical orbit |
| truck_right | partial / improved direction | two segments force stronger lateral composition and railing/storefront parallax; still has segment discontinuity and does not fully prove clean truck polarity |
| foreground_pass | no clear improvement | middle occluder helps structure, but the stitched result is not cleaner than the single FLF image2 foreground-pass candidate |

### Updated Lesson

Middle keyframes can make complex motion harder for the model to ignore, especially `orbit_right` and `truck_right`. The tradeoff is continuity: two separately generated FLF clips can jump in identity, pose, lighting, or composition at the join. This validates the idea of first-middle-last control, but also shows why a true single-workflow FML / keyframe-conditioning workflow is preferable to manual two-clip stitching.
