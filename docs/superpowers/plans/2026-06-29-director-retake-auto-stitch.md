# Director Retake Auto Stitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Director Retake selected range be sent to Edit/Bernini and automatically stitched back into the original video as a new Director output.

**Architecture:** Add a small server API that stitches `base[0:start] + edited + base[end:duration]` with ffmpeg and records a synthetic Director result run. Add frontend pending-retake context and a Retake panel preview of the selected clip. When an Edit result is available with pending context, call the stitch API and merge the returned Director run into results.

**Tech Stack:** Vanilla JS frontend, Python HTTP server, ffmpeg, Playwright e2e.

## Current implementation status

Implemented in the Director/Edit integration:

- Director result cards expose **Retake**, which loads the video into the Director Retake tab.
- Retake mode has one base video lane plus a draggable/resizable selected range.
- Sending a selected range to Edit trims the selection first, then opens the chosen Bernini/Inpaint mode with retake context.
- Each retake handoff gets a unique `retake_id`; repeated runs from the same selected range create separate pending results.
- Retake-sourced Edit payloads carry selected duration, base video dimensions, preserve-audio defaults for Bernini, and lineage metadata.
- Completed Edit runs with matching retake context can call `/api/stitch-retake-video` and produce a stitched full-length Director output.
- Stitched runs are labeled as retake outputs. Bernini/Inpaint result cards show retake-aware tags such as `retake-V2V` or `retake-Inpaint`.
- The frontend records failed stitch attempts so the same Edit output is not retried on every history refresh.
- Result polling is guarded while output videos are playing, which avoids playback jumping between refreshed result cards.

Important distinction:

- This is a cross-model Edit-to-stitch path. It is useful for replacing a selected time range with Bernini/Inpaint output.
- It is not the same as native LTX Director retake, where the original video is encoded into LTX latents and only the selected latent range is regenerated.

---

### Task 1: Backend Stitch API

**Files:**
- Modify: `server/camera_lab_server.py`

- [x] Add `stitch_retake_video(payload)` that validates `base_video_path`, `edited_video_path`, `start`, and `end`, trims base head/tail with `trim_video_clip`, merges with `merge_segment_videos`, writes a `batch.json`, and returns `{batch, run}`.
- [x] Add POST route `/api/stitch-retake-video`.
- [x] Verify with a mocked/server e2e path via Playwright route or Python test.

### Task 2: Frontend Retake Context and Preview

**Files:**
- Modify: `frontend/index.html`
- Modify: `frontend/app.js`
- Modify: `frontend/styles.css`

- [x] Add a Retake selected clip preview above `Send selection to Edit`.
- [x] Add an `Auto stitch` checkbox/toggle in the Retake edit panel.
- [x] When sending selection to Edit, store pending context: base video path/name/duration, start, end, prompt, target mode.
- [x] Render preview from current retake range and keep it in sync when the range moves.

### Task 3: Auto Stitch After Edit Result

**Files:**
- Modify: `frontend/app.js`
- Test: `tests/e2e/home.spec.js`

- [x] Detect new result runs that match the pending edit workflow and have `video`.
- [x] POST `/api/stitch-retake-video`.
- [x] Merge returned run into history/results and clear pending context.
- [x] Show errors in `runHint`.

### Task 4: Tests

**Files:**
- Modify: `tests/e2e/home.spec.js`

- [x] Add e2e for selected range preview.
- [x] Add e2e for Auto stitch pending context.
- [x] Add e2e that simulates a Bernini result and verifies `/api/stitch-retake-video` is called and Director output appears.
