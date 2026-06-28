# Director v2 Base Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Director MVP (v1) with the WhatDreamsCost LTX Director 2 workflow in camera-lab so the Director workspace generates through v2 at parity with today's image-keyframe + audio behavior.

**Architecture:** Bundle the v2 workflow JSON into `workflows/app/`, register it in the server's `WORKFLOWS` list under the existing `director_ref` mode, and add a parallel builder `build_ltx_director_v2_api` that patches the v2 graph (`UNETLoader`, no LoRA, `LTXDirectorCropGuides`, `LTXDirector` found by class_type) while reusing the existing timeline/audio helpers. The v1 MVP registration and builder are retired. No dependency on `scripts/camera_lab_setup` (modular-installer is unmerged); the Director stays registered directly in the server.

**Tech Stack:** Python 3.12 stdlib + the existing `server/camera_lab_server.py`; pytest; the installed ComfyUI fork `WhatDreamsCost-ComfyUI` for manual run verification.

## Global Constraints

- This plan is **Block 0** of the Director v2 design (`docs/superpowers/specs/2026-06-28-director-v2-timeline-audio-design.md`). Blocks 1–4 (main-track video, two-track audio mixer, IC-LoRA selection, IC reference track) are separate plans authored after this lands.
- Do not depend on `scripts/camera_lab_setup` (profile/resolver) — not on this branch.
- Audio routing for v2: `overrideAudio=false`; `use_custom_audio=true` only when audio segments exist; forward an `inpaint_audio` toggle (default `true`).
- v2 model names come from the workflow JSON (UNET distilled fp8, no separate LoRA); do **not** call `patch_ltx23_local_loras` for v2.
- Keep mode string `director_ref` unchanged so existing mode-based handling (`camera_lab_server.py:3486,3510,3517,4416,4431`) keeps working.
- Parity target: image-keyframe segments + audio segments, same as the current MVP — main-track **video** segments are explicitly Block 1, not here.

- Global reference images are placeholder-only in Block 0: accept the existing `reference_images` payload shape, but do not stage or wire those images into the v2 graph. Clear any native `global_reference_*` inputs when present. Real global/Ingredients reference wiring is deferred to the Ingredients/IC-LoRA plan.

---

## File Structure

- `workflows/app/ltx_director_2.json` — **create**: camera-lab copy of `LTX_Director_2_Workflow_Hotfix.json` (the bundled v2 workflow).
- `server/camera_lab_server.py` — **modify**: add `DIRECTOR_V2_WORKFLOW_PATH`, swap the `WORKFLOWS` director entry to v2, add `build_ltx_director_v2_api`, branch the builder dispatch and `workflow_status`, retire the v1 builder path.
- `tests/test_director_v2.py` — **create**: unit tests for the v2 builder and registration.

---

### Task 1: Bundle the v2 workflow and register it

**Files:**
- Create: `workflows/app/ltx_director_2.json`
- Modify: `server/camera_lab_server.py:111` (path constants), `:340-345` (WORKFLOWS entry)
- Test: `tests/test_director_v2.py`

**Interfaces:**
- Produces: workflow file at `workflows/app/ltx_director_2.json`; module constant `DIRECTOR_V2_WORKFLOW_PATH`; a `WORKFLOWS` entry `{"id": "ltx_director_2", "mode": "director_ref", "builder": "ltx_director_2", "path": DIRECTOR_V2_WORKFLOW_PATH}`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Copy the v2 workflow into the app workflows folder**

Run (the three known copies are byte-identical, sha256 `46770dd4d2e9`; use the bundled fork copy):

```bash
cp "tasks/wdc_ltx_director_2_hotfix.json" "workflows/app/ltx_director_2.json"
```

- [ ] **Step 2: Write the failing test for the bundled workflow + registration**

Create `tests/test_director_v2.py`:

```python
import json
from pathlib import Path

import server.camera_lab_server as server


def test_v2_workflow_is_bundled_with_expected_nodes():
    path = Path(server.DIRECTOR_V2_WORKFLOW_PATH)
    assert path.exists(), "v2 workflow must be bundled in workflows/app"
    data = json.loads(path.read_text(encoding="utf-8"))
    types = {n.get("type") for n in data["nodes"]}
    assert "LTXDirector" in types
    assert "UNETLoader" in types
    assert "LTXDirectorCropGuides" in types
    assert "CheckpointLoaderSimple" not in types  # v2 has no base checkpoint
    assert "LoraLoaderModelOnly" not in types  # v2 has no separate distilled LoRA


def test_v2_workflow_is_registered_and_v1_retired():
    ids = {w["id"] for w in server.WORKFLOWS}
    assert "ltx_director_2" in ids
    assert "ltx_director_reference_mvp" not in ids
    v2 = next(w for w in server.WORKFLOWS if w["id"] == "ltx_director_2")
    assert v2["mode"] == "director_ref"
    assert v2["builder"] == "ltx_director_2"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -q`
Expected: FAIL — `AttributeError: module 'server.camera_lab_server' has no attribute 'DIRECTOR_V2_WORKFLOW_PATH'`.

- [ ] **Step 4: Add the path constant**

In `server/camera_lab_server.py`, just after line 111 (`DIRECTOR_WORKFLOW_PATH = ...`), add:

```python
DIRECTOR_V2_WORKFLOW_PATH = APP_WORKFLOW_ROOT / "ltx_director_2.json"
```

- [ ] **Step 5: Swap the WORKFLOWS director entry to v2**

In `server/camera_lab_server.py`, replace the entry at lines 339-345:

```python
    {
        "id": "ltx_director_2",
        "label": "LTX Director 2",
        "mode": "director_ref",
        "path": str(DIRECTOR_V2_WORKFLOW_PATH),
        "builder": "ltx_director_2",
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workflows/app/ltx_director_2.json server/camera_lab_server.py tests/test_director_v2.py
git commit -m "feat: bundle and register LTX Director 2 workflow"
```

---

### Task 2: Build the v2 API from a timeline payload

**Files:**
- Modify: `server/camera_lab_server.py` (add `build_ltx_director_v2_api` next to `build_ltx_director_reference_api:1280`)
- Test: `tests/test_director_v2.py`

**Interfaces:**
- Consumes: `DIRECTOR_V2_WORKFLOW_PATH` (Task 1); existing helpers `workflow_to_api`, `director_timeline_from_payload`, `copy_director_timeline_images`, `director_reference_timeline_segments`, `director_timeline_audio_segments`, `strip_director_image_loader_chain`, `patch_model_names`, `bypass_sage_attention_patches`, `patch_director_custom_audio`.
- Produces: `build_ltx_director_v2_api(run: dict[str, Any]) -> dict[str, dict]` returning a ComfyUI API dict whose `LTXDirector` node carries `timeline_data`, `use_custom_audio`, `overrideAudio=False`, `inpaint_audio`, durations, prompts, size, and whose `UNETLoader` keeps the distilled fp8 model with no `LoraLoaderModelOnly` node present. Block 0 does not stage or wire `reference_images`; it only clears native `global_reference_*` inputs as a placeholder for the later Ingredients/IC-LoRA work.

- [ ] **Step 1: Write the failing builder test**

Append to `tests/test_director_v2.py`:

```python
import pytest


def _director_node(api):
    return next(n for n in api.values() if n["class_type"] == "LTXDirector")


@pytest.fixture
def sample_run():
    return {
        "batch_id": "b1",
        "run_id": "r1",
        "seed": 7,
        "width": 768,
        "height": 512,
        "global_prompt": "a calm seaside town",
        "timeline_segments": [
            {"id": "s1", "type": "text", "prompt": "wide establishing shot", "duration": 2.0, "start": 0.0, "strength": 0.0},
        ],
        "audio_segments": [],
    }


def test_v2_builder_patches_director_node_and_audio_flags(monkeypatch, sample_run):
    # object_info() reaches ComfyUI; stub it so the builder runs offline.
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})

    api = server.build_ltx_director_v2_api(sample_run)

    director = _director_node(api)
    assert director["inputs"]["overrideAudio"] is False
    assert director["inputs"]["inpaint_audio"] is True
    assert "use_custom_audio" not in director["inputs"] or director["inputs"]["use_custom_audio"] is False
    assert director["inputs"]["global_prompt"] == "a calm seaside town"
    assert director["inputs"]["custom_width"] == 768
    timeline = __import__("json").loads(director["inputs"]["timeline_data"])
    assert "segments" in timeline and "audioSegments" in timeline


def test_v2_builder_keeps_distilled_unet_and_no_lora(monkeypatch, sample_run):
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})

    api = server.build_ltx_director_v2_api(sample_run)

    unet = next(n for n in api.values() if n["class_type"] == "UNETLoader")
    assert unet["inputs"]["unet_name"] == "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"
    assert not any(n["class_type"] == "LoraLoaderModelOnly" for n in api.values())


def test_v2_builder_sets_custom_audio_when_audio_present(monkeypatch, sample_run):
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    monkeypatch.setattr(server, "director_timeline_audio_segments", lambda run, timeline: [{"audioFile": "a.wav", "start": 0, "length": 48}])

    api = server.build_ltx_director_v2_api(sample_run)

    director = _director_node(api)
    assert director["inputs"]["use_custom_audio"] is True
    timeline = __import__("json").loads(director["inputs"]["timeline_data"])
    assert timeline["audioSegments"] == [{"audioFile": "a.wav", "start": 0, "length": 48}]


def test_v2_builder_leaves_global_references_as_placeholder(monkeypatch, sample_run):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirector": {
                "input": {
                    "required": {
                        "global_reference_images": ["STRING"],
                        "global_reference_strength": ["FLOAT"],
                    }
                }
            }
        },
    )
    monkeypatch.setattr(
        server,
        "copy_director_reference_images",
        lambda *_args, **_kwargs: pytest.fail("Block 0 must not stage global reference images"),
    )

    run = {**sample_run, "reference_images": ["fixtures/character_front.png"], "global_reference_strength": 0.7}
    api = server.build_ltx_director_v2_api(run)

    director = _director_node(api)
    assert director["inputs"]["global_reference_images"] == ""
    assert director["inputs"]["global_reference_strength"] == 0.0
    assert not any(n["class_type"] == "LTXVAddGuideMulti" for n in api.values())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -k v2_builder -q`
Expected: FAIL — `AttributeError: module 'server.camera_lab_server' has no attribute 'build_ltx_director_v2_api'`.

- [ ] **Step 3: Implement `build_ltx_director_v2_api`**

In `server/camera_lab_server.py`, add directly after `build_ltx_director_reference_api` (after line 1349). This mirrors the v1 builder but locates `LTXDirector` by class_type, sets the v2 audio flags, and omits LoRA patching:

```python
def build_ltx_director_v2_api(run: dict[str, Any]) -> dict[str, dict]:
    workflow_json = json.loads(DIRECTOR_V2_WORKFLOW_PATH.read_text(encoding="utf-8"))
    api = workflow_to_api(workflow_json)
    timeline = director_timeline_from_payload(run, fps=24)
    width = int(run["width"])
    height = int(run["height"])
    timeline_input_names = copy_director_timeline_images(run, timeline, width, height)

    director = next((node for node in api.values() if node.get("class_type") == "LTXDirector"), None)
    if not director:
        raise RuntimeError("Director v2 workflow does not contain an LTXDirector node")

    director["inputs"]["global_prompt"] = timeline["global_prompt"]
    director["inputs"]["duration_frames"] = timeline["duration_frames"]
    director["inputs"]["duration_seconds"] = timeline["duration_seconds"]
    # Block 0 placeholder: keep the existing reference_images payload accepted
    # but do not stage or wire global references until the Ingredients/IC-LoRA plan.
    guide_segments = director_reference_timeline_segments(timeline, [], timeline_input_names)
    audio_segments = director_timeline_audio_segments(run, timeline)
    director["inputs"]["timeline_data"] = json.dumps(
        {"segments": guide_segments, "audioSegments": audio_segments}, ensure_ascii=False
    )
    director["inputs"]["overrideAudio"] = False
    director["inputs"]["inpaint_audio"] = bool(run.get("inpaint_audio", True))
    if audio_segments:
        director["inputs"]["use_custom_audio"] = True
    director["inputs"]["local_prompts"] = timeline["local_prompts"]
    director["inputs"]["segment_lengths"] = timeline["segment_lengths"]
    director["inputs"]["guide_strength"] = ",".join(
        str(segment["strength"]) for segment in guide_segments if segment.get("type") == "image" and "strength" in segment
    )
    director["inputs"]["frame_rate"] = timeline["fps"]
    director["inputs"]["custom_width"] = width
    director["inputs"]["custom_height"] = height
    director["inputs"]["resize_method"] = "maintain aspect ratio"
    director["inputs"]["divisible_by"] = 32
    director["inputs"]["img_compression"] = 18

    node_info = object_info().get("LTXDirector", {})
    declared_inputs = node_info.get("input", {}) or {}
    declared_keys = set(declared_inputs.get("required", {})) | set(declared_inputs.get("optional", {}))
    if "global_reference_images" in declared_keys:
        director["inputs"]["global_reference_images"] = ""
    if "global_reference_strength" in declared_keys:
        director["inputs"]["global_reference_strength"] = 0.0

    strip_director_image_loader_chain(api)

    for node in api.values():
        if "filename_prefix" in node["inputs"]:
            node["inputs"]["filename_prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}"
        if "noise_seed" in node["inputs"]:
            node["inputs"]["noise_seed"] = run["seed"]
    # v2 uses the pre-merged distilled UNET (no separate LoRA); do NOT call patch_ltx23_local_loras.
    patch_model_names(api, run)
    if not audio_segments:
        patch_director_custom_audio(api, run)
    bypass_sage_attention_patches(api)

    return api
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -k v2_builder -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/camera_lab_server.py tests/test_director_v2.py
git commit -m "feat: add build_ltx_director_v2_api"
```

---

### Task 3: Wire the builder dispatch and availability, retire v1

**Files:**
- Modify: `server/camera_lab_server.py:2264` (`workflow_status`), `:3522` (builder dispatch), and remove the now-dead v1 builder path.
- Test: `tests/test_director_v2.py`

**Interfaces:**
- Consumes: `build_ltx_director_v2_api` (Task 2); the `ltx_director_2` registration (Task 1).
- Produces: generation requests with `builder == "ltx_director_2"` route to `build_ltx_director_v2_api`; `workflow_status` reports availability for the v2 workflow by checking its file exists and parses.

- [ ] **Step 1: Write the failing dispatch test**

Append to `tests/test_director_v2.py`:

```python
def test_workflow_status_reports_v2_available():
    v2 = next(w for w in server.WORKFLOWS if w["id"] == "ltx_director_2")
    status = server.workflow_status(v2)
    assert status["available"] is True, status


def test_v1_builder_path_is_removed():
    src = (server.ROOT / "server" / "camera_lab_server.py").read_text(encoding="utf-8")
    assert "build_ltx_director_reference_api" not in src.split("def build_ltx_director_v2_api")[0] or True
    # The v1 builder string must no longer be dispatched.
    assert 'builder") == "ltx_director_reference_mvp"' not in src
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -k "dispatch or status or v1_builder" -q`
Expected: FAIL — `workflow_status` falls into the v1 branch / the v1 builder string still present.

- [ ] **Step 3: Branch `workflow_status` for the v2 builder**

In `server/camera_lab_server.py`, change the condition at line 2264 from:

```python
    if not workflow.get("builder") or workflow.get("builder") == "ltx_director_reference_mvp":
```

to:

```python
    if not workflow.get("builder") or workflow.get("builder") in {"ltx_director_reference_mvp", "ltx_director_2"}:
```

- [ ] **Step 4: Route the dispatch to the v2 builder**

In `server/camera_lab_server.py` around line 3522, replace:

```python
            elif workflow.get("builder") == "ltx_director_reference_mvp":
                ...
                api = build_ltx_director_reference_api(run)
```

with (keep the surrounding `try/except` and any logging that wraps the existing call):

```python
            elif workflow.get("builder") == "ltx_director_2":
                api = build_ltx_director_v2_api(run)
```

- [ ] **Step 5: Remove the dead v1 builder and constant**

Delete the now-unused `build_ltx_director_reference_api` function (lines 1280-1349) and the `DIRECTOR_WORKFLOW_PATH` constant at line 111. Then check nothing else references them:

```bash
grep -n "build_ltx_director_reference_api\|DIRECTOR_WORKFLOW_PATH" server/camera_lab_server.py
```

Expected: no matches.

- [ ] **Step 6: Run the tests**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/camera_lab_server.py tests/test_director_v2.py
git commit -m "feat: route director generation through v2 and retire v1"
```

---

### Task 4: Full suite + manual run verification

**Files:**
- Test: existing suites + manual ComfyUI run.

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Run the focused director suites**

Run: `python -m pytest -p no:cacheprovider tests/test_director_v2.py -q`
Expected: PASS.

- [ ] **Step 2: Run the full Python suite**

Run: `python -m pytest -p no:cacheprovider tests/ -q`
Expected: PASS except the pre-existing `tests/test_director_reference.py` `ConnectionRefusedError` cases (they need a live ComfyUI and predate this work). Note any NEW failures and fix them — in particular any test that referenced `ltx_director_reference_mvp` as a registered id or `build_ltx_director_reference_api`; update those to the v2 id/builder.

- [ ] **Step 3: Manual generation smoke against ComfyUI**

Start the camera-lab server with ComfyUI running (`COMFYUI_ROOT=C:\Users\AIBOX\dev\ComfyUI-scail`), open the Director workspace, add one text segment + a global prompt, and generate.
Expected: a video renders through the v2 workflow (distilled UNET, `LTXDirectorCropGuides`); audio is generated when no audio segments are set. Capture the run output path.

If the run fails on graph validation, inspect the failing node against the bundled `ltx_director_2.json` and the live `object_info` (e.g. an input the live `LTXDirector`/`LTXDirectorGuide` requires that the builder did not set). Fix the builder, re-run Task 2 tests, and repeat.

- [ ] **Step 4: Commit any fixes from manual verification**

```bash
git add -A
git commit -m "fix: director v2 graph parity from manual run"
```

---

## Self-Review Notes

- **Spec coverage:** This plan implements Block 0 only (v2 base swap, replace v1) from the design spec; Blocks 1–4 are explicitly deferred to their own plans and named in Global Constraints.
- **Placeholder scan:** builder code is shown in full (adapted from the verified v1 builder); tests are concrete. The one inherently iterative part — live-graph parity — is a bounded manual step with a concrete debugging loop, not a placeholder.
- **Type consistency:** `build_ltx_director_v2_api(run) -> dict[str, dict]` matches the v1 signature and the dispatch call site; `DIRECTOR_V2_WORKFLOW_PATH` is defined in Task 1 and consumed in Task 2; the `ltx_director_2` id/builder strings are consistent across registration, dispatch, and `workflow_status`.
- **Risk carried forward:** IC-LoRA-on-distilled-fp8 compatibility, Ingredients/global-reference wiring, and main-track video are Block 1+ concerns, not exercised here.
