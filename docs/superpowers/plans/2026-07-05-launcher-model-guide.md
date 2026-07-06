# Launcher Model Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the launcher's hardware assessment, print a per-module ("per-tab") guide listing each required model, whether it is present or missing, its install path, and its download-page URL.

**Architecture:** Add a `page_url` field to `ModelRef` and fill verified download-page URLs for the camera + director required models. Add two functions to `scripts/launch.py` — a pure `model_guide_rows(assessment)` and `print_model_guide(assessment)` — and call the printer right after `print_assessment` in `main()`. The existing auto-downloader is untouched.

**Tech Stack:** Python 3.12 stdlib + the existing `scripts/camera_lab_setup` package; pytest.

## Global Constraints

- **All product text is English only — no Chinese** in code, comments, string literals, or committed data.
- Do NOT modify the auto-download path (`missing_downloadable_models`, `maybe_download_models`, `download_file`).
- `ModelRef` is frozen and constructed positionally as `ModelRef(folder, name, source_url="")`; `page_url` MUST be a trailing keyword field with a default so every existing call stays valid.
- The guide reuses the existing `assess()` output; it makes NO new ComfyUI calls.
- `_hf(repo, path)` already exists: `https://huggingface.co/{repo}/resolve/main/{path}`. The page for a repo is `https://huggingface.co/{repo}`.

---

## File Structure

- `scripts/camera_lab_setup/modules.py` — **modify**: add `page_url` to `ModelRef`; add `_hf_page(repo)`; fill `page_url` on camera + director required models.
- `scripts/launch.py` — **modify**: add `model_guide_rows(assessment, modules=MODULES)` and `print_model_guide(assessment)`; call `print_model_guide` in `main()` after `print_assessment`.
- `tests/test_launch.py` — **modify**: unit tests for the two new functions.
- `tests/test_model_guide_pages.py` — **create**: coverage test that camera + director models all have a `page_url`.

---

### Task 1: Add `page_url` to `ModelRef` and an `_hf_page` helper

**Files:**
- Modify: `scripts/camera_lab_setup/modules.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: existing `ModelRef`, `_hf`.
- Produces: `ModelRef(folder, name, source_url="", page_url="")` (frozen dataclass with the new trailing field); `_hf_page(repo: str) -> str` returning `https://huggingface.co/{repo}`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_launch.py`:

```python
def test_modelref_has_page_url_and_hf_page_helper():
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
    from camera_lab_setup.modules import ModelRef, _hf_page

    # positional construction (no page_url) still works
    r = ModelRef("vae", "x.safetensors", "https://example/resolve/main/x")
    assert r.page_url == ""
    r2 = ModelRef("vae", "x.safetensors", page_url="https://huggingface.co/org/repo")
    assert r2.page_url == "https://huggingface.co/org/repo"
    assert _hf_page("Lightricks/LTX-Video") == "https://huggingface.co/Lightricks/LTX-Video"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py::test_modelref_has_page_url_and_hf_page_helper -q`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'page_url'` (or `AttributeError` on `page_url`).

- [ ] **Step 3: Add the field and helper**

In `scripts/camera_lab_setup/modules.py`, add `page_url` as the last field of `ModelRef`:

```python
@dataclass(frozen=True)
class ModelRef:
    folder: str
    name: str
    source_url: str = ""
    page_url: str = ""
```

And add near `_hf` (after its definition):

```python
def _hf_page(repo: str) -> str:
    return f"https://huggingface.co/{repo}"
```

- [ ] **Step 4: Run the test + full suite**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q && python -m pytest -p no:cacheprovider tests/test_installer_profiles.py tests/test_modular_install.py -q`
Expected: PASS (the new field default keeps existing `ModelRef(...)` construction valid).

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/modules.py tests/test_launch.py
git commit -m "feat: add page_url to ModelRef and _hf_page helper"
```

---

### Task 2: Fill verified download pages for camera + director models

**Files:**
- Modify: `scripts/camera_lab_setup/modules.py`
- Test: `tests/test_model_guide_pages.py`

**Interfaces:**
- Consumes: Task 1 (`page_url`, `_hf_page`).
- Produces: every required model of the `camera` (`camera-ltx23-fp8`) and `director` (`director-v2-distilled-fp8`) profiles has a non-empty `page_url`.

- [ ] **Step 1: Research each model's download page**

For each required model of `camera-ltx23-fp8` and `director-v2-distilled-fp8` (the first profile of each module), find the HuggingFace repo that hosts that exact filename and record its page `https://huggingface.co/<repo>`. Verify each by loading the page and confirming the file is listed. The model filenames are (folder / name):

- camera: `checkpoints/ltx-2.3-22b-dev-fp8.safetensors`, `loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`, `latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors`, `text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`, `text_encoders/ltx-2.3_text_projection_bf16.safetensors`
- director: `diffusion_models/ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors`, `latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors`, `vae/LTX23_audio_vae_bf16.safetensors`, `vae/LTX23_video_vae_bf16.safetensors`, `vae/taeltx2_3.safetensors`, `text_encoders/gemma_3_12B_it_fp4_mixed.safetensors`, `text_encoders/ltx-2.3_text_projection_bf16.safetensors`

Record the confirmed repo for each. If a file is genuinely not on any public repo, leave its `page_url` empty and note it in the commit message (the guide will show "no public source").

- [ ] **Step 2: Write the coverage test**

Create `tests/test_model_guide_pages.py`:

```python
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from camera_lab_setup.modules import MODULES


def _profile(module_id, profile_id):
    m = next(x for x in MODULES if x.id == module_id)
    return next(p for p in m.model_profiles if p.id == profile_id)


def test_camera_and_director_models_have_page_urls():
    missing = []
    for mid, pid in (("camera", "camera-ltx23-fp8"), ("director", "director-v2-distilled-fp8")):
        for r in _profile(mid, pid).required_models or ():
            if not r.page_url:
                missing.append(f"{mid}:{r.folder}/{r.name}")
    assert missing == [], f"models without a download page_url: {missing}"
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_model_guide_pages.py -q`
Expected: FAIL — lists the camera/director models that still have empty `page_url`.

- [ ] **Step 4: Fill `page_url` on each model**

Edit `scripts/camera_lab_setup/modules.py` so each camera + director required `ModelRef` includes the verified `page_url=...` (use `_hf_page("<repo>")` for HuggingFace repos). Set only the values confirmed in Step 1; leave genuinely-unavailable ones empty and adjust the test's expectation if any are legitimately impossible (documenting why in the commit).

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_model_guide_pages.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/camera_lab_setup/modules.py tests/test_model_guide_pages.py
git commit -m "feat: fill download-page URLs for camera + director models"
```

---

### Task 3: `model_guide_rows` — the pure guide builder

**Files:**
- Modify: `scripts/launch.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: `MODULES` (already imported in `launch.py`); `assess()` output shape `{"has_comfy": bool, "modules": [{"id","ready","profile","feasibility","missing"}]}`.
- Produces: `model_guide_rows(assessment, modules=MODULES) -> list[dict]` where each row is `{"module": str, "name": str, "folder": str, "install_path": str, "page_url": str, "present": bool | None}`. Rows are ordered by the module order in `assessment["modules"]`. `install_path == f"models/{folder}/{name}"`. `present` is `None` when `assessment["has_comfy"]` is falsy, else `name not in that module's missing`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_launch.py`:

```python
from scripts.launch import model_guide_rows


def _fake_module(mid, profile_id, models):
    class _P:
        id = profile_id
        required_models = models
    class _M:
        id = mid
        model_profiles = [_P()]
    return _M()


def test_model_guide_rows_paths_and_presence():
    class _R:
        def __init__(self, folder, name, page):
            self.folder, self.name, self.page_url = folder, name, page
    mods = [
        _fake_module("camera", "camera-ltx23-fp8", [_R("checkpoints", "a.safetensors", "https://huggingface.co/org/repo")]),
    ]
    assessment = {
        "has_comfy": True,
        "modules": [{"id": "camera", "profile": "camera-ltx23-fp8", "missing": ["a.safetensors"]}],
    }
    rows = model_guide_rows(assessment, modules=mods)
    assert rows == [
        {
            "module": "camera",
            "name": "a.safetensors",
            "folder": "checkpoints",
            "install_path": "models/checkpoints/a.safetensors",
            "page_url": "https://huggingface.co/org/repo",
            "present": False,
        }
    ]


def test_model_guide_rows_present_none_when_no_comfy():
    class _R:
        folder, name, page_url = "vae", "v.safetensors", ""
    mods = [_fake_module("edit", "edit-x", [_R()])]
    rows = model_guide_rows({"has_comfy": False, "modules": [{"id": "edit", "profile": "edit-x", "missing": []}]}, modules=mods)
    assert rows[0]["present"] is None
    assert rows[0]["page_url"] == ""
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: FAIL — `ImportError: cannot import name 'model_guide_rows'`.

- [ ] **Step 3: Implement `model_guide_rows`**

Add to `scripts/launch.py` (after `assess`):

```python
def _module_by_id(modules, module_id):
    for module in modules:
        if module.id == module_id:
            return module
    return None


def model_guide_rows(assessment, modules=MODULES):
    rows = []
    for entry in assessment.get("modules", []):
        module = _module_by_id(modules, entry.get("id"))
        if module is None:
            continue
        profile = _profile_by_id(module, entry.get("profile")) if entry.get("profile") else None
        if profile is None:
            profile = module.model_profiles[0] if module.model_profiles else None
        required = list(getattr(profile, "required_models", ()) or ()) if profile else []
        missing = set(entry.get("missing", []))
        has_comfy = bool(assessment.get("has_comfy"))
        for ref in required:
            rows.append(
                {
                    "module": module.id,
                    "name": ref.name,
                    "folder": ref.folder,
                    "install_path": f"models/{ref.folder}/{ref.name}",
                    "page_url": getattr(ref, "page_url", "") or "",
                    "present": (ref.name not in missing) if has_comfy else None,
                }
            )
    return rows
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/launch.py tests/test_launch.py
git commit -m "feat: model_guide_rows builds the per-module model guide"
```

---

### Task 4: `print_model_guide` and wire it into `main()`

**Files:**
- Modify: `scripts/launch.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: `model_guide_rows` (Task 3).
- Produces: `print_model_guide(assessment) -> None` printing rows grouped by module with a status tag (`[ok]`/`[missing]`/`[needed]`), the install path, and the page URL (or `no public source — obtain manually` when empty). `main()` calls it right after `print_assessment`, before the `--assess-only` return.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_launch.py`:

```python
from scripts.launch import print_model_guide


def test_print_model_guide_tags_and_paths(capsys, monkeypatch):
    rows = [
        {"module": "camera", "name": "a", "folder": "checkpoints", "install_path": "models/checkpoints/a", "page_url": "https://huggingface.co/org/repo", "present": False},
        {"module": "camera", "name": "b", "folder": "vae", "install_path": "models/vae/b", "page_url": "", "present": None},
    ]
    monkeypatch.setattr("scripts.launch.model_guide_rows", lambda assessment, modules=None: rows)
    print_model_guide({"has_comfy": True, "modules": []})
    out = capsys.readouterr().out
    assert "camera:" in out
    assert "[missing] models/checkpoints/a" in out
    assert "https://huggingface.co/org/repo" in out
    assert "[needed] models/vae/b" in out
    assert "no public source" in out
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: FAIL — `ImportError: cannot import name 'print_model_guide'`.

- [ ] **Step 3: Implement `print_model_guide` and wire into `main`**

Add to `scripts/launch.py`:

```python
def print_model_guide(assessment) -> None:
    rows = model_guide_rows(assessment)
    print("Model guide (download each missing file and place it at the listed path):")
    current = None
    for row in rows:
        if row["module"] != current:
            current = row["module"]
            print(f"  {current}:")
        if row["present"] is True:
            tag = "[ok]     "
        elif row["present"] is False:
            tag = "[missing]"
        else:
            tag = "[needed] "
        print(f"    {tag} {row['install_path']}")
        source = row["page_url"] or "no public source - obtain manually"
        print(f"             {source}")
```

Then in `main()`, add the call immediately after `print_assessment(assessment)` and before the `--assess-only` check:

```python
    print_assessment(assessment)
    print_model_guide(assessment)
    if args.assess_only:
        return 0
```

- [ ] **Step 4: Run the test + full suite**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q && python -m pytest -p no:cacheprovider -q`
Expected: PASS (no regressions).

- [ ] **Step 5: Manual smoke (optional, host)**

Run: `python scripts/launch.py --assess-only`
Expected: prints the hardware assessment, then the per-module model guide with `[ok]`/`[missing]`/`[needed]` tags, install paths, and pages; launches nothing.

- [ ] **Step 6: Commit**

```bash
git add scripts/launch.py tests/test_launch.py
git commit -m "feat: print per-module model guide after the launcher assessment"
```

---

## Self-Review

**Spec coverage:**
- `page_url` field on `ModelRef` + `_hf_page` → Task 1. ✓
- Verified download pages for camera + director → Task 2 (+ coverage test). ✓
- `model_guide_rows(assessment)` pure, grouped by module, install path, present/None → Task 3. ✓
- `print_model_guide` after `print_assessment`, before `--assess-only` return, status tags + page/no-source → Task 4. ✓
- Auto-downloader untouched → no task modifies it. ✓
- English-only → all strings in the plan are English. ✓
- Presence unknown when no comfy → Task 3 `present=None`, Task 4 `[needed]`. ✓
- No new ComfyUI calls → `model_guide_rows` reads only `assessment` + `MODULES`. ✓

**Placeholder scan:** No TBD/TODO. Task 2 is genuine research (the plan lists the exact filenames to find pages for and a coverage test that fails until each has a URL) — not a placeholder; the concrete URLs are filled by the implementer after verification, which the test enforces.

**Type consistency:** `page_url`, `_hf_page`, `model_guide_rows(assessment, modules=MODULES)`, `print_model_guide(assessment)`, and the row dict keys `{module,name,folder,install_path,page_url,present}` are defined once and used consistently across Tasks 3-4 and their tests. `_profile_by_id` already exists in `launch.py` (used by `assess`) and is reused in Task 3.
