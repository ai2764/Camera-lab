# Director Reference MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP mode that runs a complete LTX Director timeline with user-uploaded reference setting images.

**Architecture:** Reuse the existing Camera Lab server and web UI. Add a backend builder that converts the known Director workflow into an API prompt, patches timeline fields, and inserts `LTXVAddGuideMulti` after the Director guide stage. Add a compact UI mode with reference upload slots, segment rows, full-run generation, and segment seek buttons.

**Tech Stack:** Python `http.server`, ComfyUI HTTP API, vanilla HTML/CSS/JavaScript.

---

### Task 1: Backend Director Builder

**Files:**
- Modify: `tools/camera_lab_server.py`

- [ ] Add `ltx_director_reference_mvp` to `WORKFLOWS`.
- [ ] Add helper functions to sanitize timelines, copy reference images to Comfy input, convert seconds to frames, and build a Director API prompt from `LTX Director Example Workflow (Fixed).json`.
- [ ] In `run_worker`, route this workflow to the new builder.
- [ ] Save `director_timeline.json` for each run.

### Task 2: API Payload Support

**Files:**
- Modify: `tools/camera_lab_server.py`

- [ ] Extend `handle_run` to accept `global_prompt`, `segments`, and `reference_images`.
- [ ] Do not require the legacy source image for this workflow.
- [ ] Store director metadata on each run so `/api/history` and `/api/batches` can return it.

### Task 3: UI Director Mode

**Files:**
- Modify: `tools/camera_lab_web/index.html`
- Modify: `tools/camera_lab_web/app.js`
- Modify: `tools/camera_lab_web/styles.css`

- [ ] Add a director panel with four reference slots.
- [ ] Add editable segment rows with prompt, duration, reference role, guide frame, and strength.
- [ ] Make `collectPayload()` submit director metadata for the new workflow.
- [ ] Hide legacy camera-move/source-image controls when the selected workflow mode is `director_ref`.

### Task 4: Segment Preview Controls

**Files:**
- Modify: `tools/camera_lab_web/app.js`
- Modify: `tools/camera_lab_web/styles.css`

- [ ] Render segment buttons on result cards when a run has director segments.
- [ ] Clicking a segment seeks the full video to that segment's start time.
- [ ] Keep regeneration as a full timeline rerun by using the same run button.

### Task 5: Verification

**Files:**
- Test by running commands.

- [ ] Run `python -m py_compile tools/camera_lab_server.py`.
- [ ] Run a lightweight API-prompt build check if ComfyUI is online.
- [ ] Run the Camera Lab server and verify the page loads.
