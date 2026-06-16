# HY-Motion Text-to-Motion UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a camera-lab "Motion" tab that turns a text description + a reference character image into a video, via two staged ComfyUI runs (`text → HY-Motion guide → SCAIL-2 video`).

**Architecture:** Two separate ComfyUI workflow submissions orchestrated by the existing `BaseHTTPRequestHandler` server. Stage A (HY-Motion) renders a static-camera skeleton guide; the guide's frame count drives Stage B (SCAIL) `length`; both submit to an optional second ComfyUI endpoint that falls back to the single instance after the planned node migration. Frontend reuses the existing workspace-tab + `/api/run`-style batch pattern.

**Tech Stack:** Python 3 stdlib HTTP server (`server/camera_lab_server.py`), vanilla JS frontend (`frontend/app.js`, `index.html`), pytest (`pytest.ini`), Playwright e2e. ComfyUI API format JSON workflows in `workflows/app/`.

**Design spec:** `docs/superpowers/specs/2026-06-16-hymotion-text-to-motion-ui-design.md` — read it first.

**Reference (verified) facts:**
- `http_json(path, payload=None, timeout=30)` at `server/camera_lab_server.py:376` uses global `COMFY_URL`.
- `WORKFLOWS` registry at `:161`; worker `run_batch_worker` at `:2001`; submit pattern at `:2077`; `wait_for_completion` at `:1699`; `copy_outputs` at `:1629`.
- SCAIL API template = `C:/Users/AIBOX/dev/ComfyUI-scail/scail2_native_test.json`. Node IDs: `[3]` ModelSamplingSD3 shift, `[13]` WanSCAILToVideo (width/height/length/pose_strength), `[14]` KSampler (seed/steps/cfg=1.0), `[16]` CreateVideo fps, `[17]` SaveVideo.
- HY-Motion nodes in `C:/Users/AIBOX/dev/ComfyUI-scail/custom_nodes/ComfyUI-HY-Motion1/nodes.py`. Generate params: `duration` 0.5–12, `seed`, `cfg_scale` 1–15 (default 5), `num_samples`. Guide fps = 30.
- align-to-4k+1: SCAIL `length` must satisfy `(length-1) % 4 == 0`.

---

## Phase 1 — Minimal dual-endpoint plumbing

### Task 1: `base_url` param + `MOTION_COMFY_URL`

**Files:**
- Modify: `server/camera_lab_server.py:376-396` (`http_json`, `http_post`)
- Modify: `server/camera_lab_server.py:78-79` (config block, add `MOTION_COMFY_URL`)
- Modify: `.env.example`
- Test: `tests/test_motion_endpoint.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_motion_endpoint.py
import server.camera_lab_server as s

def test_motion_url_falls_back_to_comfy_url(monkeypatch):
    monkeypatch.delenv("COMFYUI_MOTION_URL", raising=False)
    assert s.motion_comfy_url(env={}) == s.COMFY_URL

def test_motion_url_uses_env_when_set():
    assert s.motion_comfy_url(env={"COMFYUI_MOTION_URL": "http://127.0.0.1:8188"}) == "http://127.0.0.1:8188"

def test_http_json_uses_base_url(monkeypatch):
    captured = {}
    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'
    def fake_urlopen(req, timeout=0):
        captured["url"] = req if isinstance(req, str) else req.full_url
        return FakeResp()
    monkeypatch.setattr(s.urllib.request, "urlopen", fake_urlopen)
    s.http_json("/system_stats", base_url="http://127.0.0.1:8188")
    assert captured["url"].startswith("http://127.0.0.1:8188")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_motion_endpoint.py -v`
Expected: FAIL (`motion_comfy_url` undefined / `http_json` has no `base_url`).

- [ ] **Step 3: Implement**

In `server/camera_lab_server.py`, after line 79 (`COMFY_URL = COMFY_CONFIG["url"]`):

```python
def motion_comfy_url(env: Mapping[str, str] = os.environ) -> str:
    """ComfyUI endpoint for HY-Motion/SCAIL. Falls back to COMFY_URL so a future
    single-instance migration needs no code change — just unset COMFYUI_MOTION_URL."""
    return env.get("COMFYUI_MOTION_URL") or COMFY_URL

MOTION_COMFY_URL = motion_comfy_url()
```

Change `http_json` (`:376`) and `http_post` (`:391`) signatures and first line:

```python
def http_json(path: str, payload: dict | None = None, timeout: int = 30, base_url: str | None = None) -> dict:
    url = (base_url or COMFY_URL).rstrip("/") + path
    ...

def http_post(path: str, payload: dict | None = None, timeout: int = 30, base_url: str | None = None) -> None:
    url = (base_url or COMFY_URL).rstrip("/") + path
    ...
```

Add to `.env.example`:

```
# Optional: second ComfyUI instance hosting HY-Motion + SCAIL nodes.
# Unset once those nodes are migrated into the main COMFYUI_URL instance.
COMFYUI_MOTION_URL=http://127.0.0.1:8188
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_motion_endpoint.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add server/camera_lab_server.py .env.example tests/test_motion_endpoint.py
git commit -m "feat(motion): optional COMFYUI_MOTION_URL endpoint with COMFY_URL fallback"
```

---

## Phase 2 — Workflow templates + two-stage orchestration

### Task 2: SCAIL video workflow template

**Files:**
- Create: `workflows/app/scail2_video.api.json` (copy of the verified template)

- [ ] **Step 1:** Copy the proven API-format workflow into camera-lab:

```bash
cp /c/Users/AIBOX/dev/ComfyUI-scail/scail2_native_test.json workflows/app/scail2_video.api.json
```

- [ ] **Step 2:** Confirm the node IDs the patcher will target are present:

Run: `python -c "import json; w=json.load(open('workflows/app/scail2_video.api.json')); print({k:w[k]['class_type'] for k in ['3','13','14','16','17']})"`
Expected: `{'3': 'ModelSamplingSD3', '13': 'WanSCAILToVideo', '14': 'KSampler', '16': 'CreateVideo', '17': 'SaveVideo'}`. If IDs differ, record the actual IDs and use them in Task 6.

- [ ] **Step 3: Commit**

```bash
git add workflows/app/scail2_video.api.json
git commit -m "feat(motion): add SCAIL-2 video workflow template"
```

### Task 3: HY-Motion guide workflow template — ✅ DONE (validated on 8188)

> **Done, code-authored (no GUI build needed).** Derived from the plugin's official `workflow-rewrite prompt.json`, but **direct-prompt** (Prompt Rewrite is done in-server via `llm_chat`, see Task 5) and with a video-output tail. Committed `9678996`.

**Files:**
- `workflows/app/hymotion_guide.api.json` — runtime (API format), direct-load + patch.
- `workflows/app/hymotion_guide.ui.json` — GUI-viewable twin (open in ComfyUI to inspect the graph).

Final graph (7 nodes): `HYMotionLoadLLM(15: Qwen3-8B-bnb-4bit/bnb-4bit) → HYMotionEncodeText(10: text=literal) ← / HYMotionLoadNetwork(4: HY-Motion-1.0) → HYMotionGenerate(5: duration=literal, seed=42, cfg_scale=5.0) → HYMotionPreview(6: frame_step=1, image_size=512) → CreateVideo(30: fps=30) → SaveVideo(31: motion/guide, mp4, h264)`.

**Builder patch targets (node IDs in `hymotion_guide.api.json`):** `10.inputs.text` ← rewritten/literal prompt; `5.inputs.duration` ← seconds; `5.inputs.seed`, `5.inputs.cfg_scale`; `31.inputs.filename_prefix` ← per-run prefix.

**Validation (done):** POST to 8188 `/prompt` completed; output `output/motion/guide_00001_.mp4` = 512×512, 30fps, 120 frames at duration=4.0.

**Note — dependency:** the dropped HY-Motion Prompter path required `openai` (now installed in the comfy-scail env) and a ~61GB Text2MotionPrompter model; both avoided by doing rewrite in-server (Task 5).

### Task 4: Frame-count + length helpers

**Files:**
- Modify: `server/camera_lab_server.py` (add helpers near `copy_outputs`)
- Test: `tests/test_motion_length.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_motion_length.py
import server.camera_lab_server as s

def test_align_4k1_rounds_down_to_valid_length():
    assert s.align_4k1(90) == 89      # nearest <= value with (n-1)%4==0
    assert s.align_4k1(49) == 49
    assert s.align_4k1(50) == 49
    assert s.align_4k1(1) == 1

def test_align_4k1_minimum_is_1():
    assert s.align_4k1(0) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_motion_length.py -v`
Expected: FAIL (`align_4k1` undefined).

- [ ] **Step 3: Implement** (add after `copy_outputs`, ~`:1693`):

```python
def align_4k1(n: int) -> int:
    """Largest valid SCAIL length <= n with (length-1) % 4 == 0; min 1."""
    if n <= 1:
        return 1
    return ((n - 1) // 4) * 4 + 1

def video_frame_count(path: Path) -> int:
    """Frame count of a video via ffprobe (ffmpeg already used for contact sheets)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return int(out)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_motion_length.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add server/camera_lab_server.py tests/test_motion_length.py
git commit -m "feat(motion): add align_4k1 + video_frame_count helpers"
```

### Task 5: Stage A builder (HY-Motion) + Task 6: Stage B builder (SCAIL) + Task 7: two-stage worker

> These three tasks share the motion-run data model. Implement in order; each ends in a commit. Builders patch the API templates by node ID (from Tasks 2–3), submitting with `base_url=MOTION_COMFY_URL`. The worker mirrors `run_batch_worker` (`:2001`): write `api_prompt.json`, submit `/prompt`, `wait_for_completion`, `copy_outputs`.

**Files:** Modify `server/camera_lab_server.py`; Test `tests/test_motion_builders.py`.

- [ ] **Task 5a — In-server prompt rewrite helper.**
  - Implement `rewrite_motion_prompt(text) -> tuple[str, float]` using the existing `llm_chat()` (`:2254`) with HY-Motion's `REWRITE_AND_INFER_TIME_PROMPT_FORMAT` template (copy the template text into a module constant — do NOT import from the plugin). Parse the JSON reply (reuse the resilient extractor at `:2489`) → `(short_caption, duration_frames/30.0)`. On parse failure or LLM unavailable, fall back to `(text, default_duration)`.
  - Test: stub `llm_chat` to return `'{"duration": 120, "short_caption": "X walks."}'`; assert `("X walks.", 4.0)`. Stub a malformed reply; assert fallback `(text, default)`.
  - Commit: `feat(motion): in-server LLM prompt rewrite`.

- [ ] **Task 5b — Stage A builder.**
  - Test: `build_hymotion_api(run, template_path)` patches `10.inputs.text` (prompt — rewritten when `run["rewrite"]` else literal), `5.inputs.duration` (seconds), `5.inputs.seed`, `5.inputs.cfg_scale`, and `31.inputs.filename_prefix` (per-run); assert values land on the right node IDs of `hymotion_guide.api.json`.
  - Implement `build_hymotion_api(run, template_path)` returning the patched API dict (calls `rewrite_motion_prompt` when enabled). Submit via `http_json("/prompt", {"prompt": api, "client_id": ...}, base_url=MOTION_COMFY_URL)`.
  - Commit: `feat(motion): HY-Motion stage builder`.

- [ ] **Task 6 — Stage B builder.**
  - Test: `build_scail_api(run, guide_name, length)` sets node `13` width/height/length/pose_strength, node `14` seed/steps (cfg stays 1.0), and the `LoadVideo`/guide input to `guide_name`; assert values.
  - Implement; submit with `base_url=MOTION_COMFY_URL`.
  - Commit: `feat(motion): SCAIL stage builder`.

- [ ] **Task 7 — `/api/text-to-motion` endpoint + worker.**
  - Add route `/api/text-to-motion` in `do_POST` (`:2645`) → `handle_text_to_motion` (mirror `handle_run` `:2713`: create run dir, store params, start `motion_worker` thread).
  - `motion_worker(run)`: Stage A → copy guide → `length = align_4k1(video_frame_count(guide))` → copy guide into `COMFY_INPUT` for stage B → Stage B → copy final video. On Stage A done, set `run["guide_video"]` so the UI can preview before B finishes (B runs in same worker; UI polls).
  - Reuse `wait_for_completion`/`copy_outputs` with `base_url`-aware submit. Status transitions: `running_motion` → `running_video` → `done`.
  - Test: unit-test `motion_worker` length wiring with stubbed `http_json`/`copy_outputs`/`video_frame_count` (assert Stage B receives `align_4k1(N)`).
  - Commit: `feat(motion): two-stage text-to-motion endpoint`.

---

## Phase 3 — Frontend Motion tab

### Task 8: Tab + panel markup

**Files:** Modify `frontend/index.html` (nav `:15-19`, add a `motion` panel section).

- [ ] **Step 1:** Add tab button after line 18: `<button id="motionWorkspaceTab" class="workspace-tab" type="button">Motion</button>`.
- [ ] **Step 2:** Add a `motion-panel` section with controls (match existing label/input style):
  - `motionPrompt` (textarea), `motionRefInput` (`type=file`), size preset/scale (reuse existing `sizePreset`/`sizeScale` markup pattern), `motionSteps` (`number` default 8), `motionSeed` (`number`, placeholder Random).
  - Collapsed `<details>` "Advanced": `motionPoseStrength` (`range` 0–10 step 0.01 value 1.0), `motionCfg` (`range` 1–15 step 0.5 value 5).
  - Guide preview `<video id="motionGuide" controls>` + final `<video id="motionResult" controls>`.
- [ ] **Step 3: Commit** `feat(motion): add Motion tab markup`.

### Task 9: Workspace wiring

**Files:** Modify `frontend/app.js` (`setWorkspace` near `:361`, listeners near `:2929`).

- [ ] **Step 1:** Add `motionWorkspaceTab` toggle in the `setWorkspace` render block and a listener `$("motionWorkspaceTab").addEventListener("click", () => setWorkspace("motion", { syncWorkflow: false }));`.
- [ ] **Step 2:** Show/hide the `motion-panel` based on `state.workspace === "motion"` (follow how `casting`/`photography` panels toggle).
- [ ] **Step 3: Commit** `feat(motion): wire Motion workspace`.

### Task 10: Submit + two-step preview

**Files:** Modify `frontend/app.js`.

- [ ] **Step 1:** `uploadImage(file, "motion_ref")` reuse of existing `/api/upload-image` (`:2104`) for the reference image.
- [ ] **Step 2:** `startMotion()` — POST the form to `/api/text-to-motion` via `api()`; then `pollMotion()` (clone of `pollBatch` `:1972`): when status reaches `running_video` and `guide_video` is present, set `motionGuide.src`; when `done`, set `motionResult.src`.
- [ ] **Step 3: Commit** `feat(motion): two-step submit + guide/result preview`.

### Task 11: e2e smoke test

**Files:** Create `tests/e2e/motion.spec.js` (Playwright; mock `/api/text-to-motion` + poll responses so it runs without GPU).

- [ ] **Step 1:** Test: clicking the Motion tab shows the panel; submitting with a prompt + mocked backend surfaces the guide video then the result video.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/motion.spec.js`; Expected: PASS.
- [ ] **Step 3: Commit** `test(motion): e2e smoke for Motion tab`.

---

## Self-review notes

- **Spec coverage:** two-step staged flow (Tasks 7–10), auto duration→length (Tasks 4, 7), fps=30 fixed (Task 3 template), exposed params prompt/ref/size/steps/seed + advanced pose_strength/cfg (Tasks 8–10), hardcoded recipe lives in the templates (Tasks 2–3), minimal endpoint (Task 1), two workflows (Tasks 2–3, 7). Out-of-scope items (num_samples, replacement_mode, Kimodo) intentionally absent.
- **Open dependency:** Task 3 requires the 8188 instance running to export a correct API template; node IDs in Tasks 5–6 must be confirmed from the saved JSON (Step 2 of Tasks 2–3 capture them).
- **Migration-safe:** Task 1's fallback means no code change when ComfyUI consolidates to one instance.
```
