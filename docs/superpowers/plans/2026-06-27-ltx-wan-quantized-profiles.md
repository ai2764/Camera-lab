# ≥8GB Quantized Profiles & Workflow Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the LTX and WAN model families a verified VRAM-keyed GGUF quant ladder plus GGUF workflow variants, so the installer's resolver recommends a fitting quant tier for ≥8GB GPUs on `camera`/`director`/`edit`.

**Architecture:** Add quant-ladder profiles (data) to the existing `camera_lab_setup` module registry; teach the resolver to pick the highest-quality *ready* profile whose `min_vram_gb` fits detected VRAM; add one GGUF workflow JSON per family that swaps FP8 loaders for GGUF loaders. No new packages.

**Tech Stack:** Python 3.10+ stdlib (dataclasses, urllib), pytest, existing ComfyUI `/object_info` visibility, ComfyUI-GGUF / ComfyUI-KJNodes / ComfyUI-BerniniR custom nodes (detected, not installed here).

## Global Constraints

- Do not install ComfyUI, model weights, or custom nodes automatically; this sub-project only registers verified metadata and authors workflow JSON.
- Verification bar is **source exists + node loadable**: every model `source_url` must be HTTP-HEAD reachable, and every loader node a workflow variant uses must be a known GGUF node class. No real-machine generation, no measured 8GB VRAM ceiling.
- Every filename, URL, and byte size is verified against the real repository during the task that introduces it — never trusted from memory or from the current (partly wrong) registry.
- LoRAs, VAEs, and the spatial upscaler are reused unchanged from the existing FP8 profiles; only the large diffusion model and the text encoder are swapped to GGUF.
- Keep existing module ids and `frontend_workspace` values unchanged: `camera`, `director`, `edit`, `casting`, `motion`.
- `motion`/SCAIL2 has no public GGUF; it must be marked honestly, never faked.
- HuggingFace download URL form: `https://huggingface.co/<repo>/resolve/main/<path>`.

---

## File Structure

- Modify `scripts/camera_lab_setup/modules.py` — add `_hf()` URL helper; replace the LTX/WAN/SCAIL GGUF stub profiles with verified quant-ladder profiles carrying `source_url`, `disk_gb`, VRAM bands, and GGUF `required_nodes`.
- Modify `scripts/camera_lab_setup/resolver.py` — VRAM-aware tier selection among ready profiles.
- Create `workflows/app/ltx23_gguf_i2v_nag_extend.json` — LTX GGUF workflow variant.
- Create `workflows/app/wan22_bernini_gguf_i2v.json` — WAN/Bernini GGUF workflow variant.
- Modify `tests/test_modular_install.py` — registry ladder + resolver tier-selection tests.
- Create `tests/test_quant_profiles.py` — URL reachability (network) + workflow/registry consistency tests.

## Verified Artifact Reference (pin during Task 1; re-HEAD if stale)

LTX diffusion — repo `QuantStack/LTX-2.3-GGUF`, path prefix `LTX-2.3-distilled/`:
- `LTX-2.3-distilled-Q2_K.gguf` 12,408,653,632 B (~12 GB)
- `LTX-2.3-distilled-Q4_K_S.gguf` 16,706,375,488 B (~17 GB)
- `LTX-2.3-distilled-Q4_K_M.gguf` 17,763,012,416 B (~18 GB)
- `LTX-2.3-distilled-Q8_0.gguf` 25,499,062,080 B (~25 GB)

LTX text encoder — repo `unsloth/gemma-3-12b-it-qat-GGUF`, file `gemma-3-12b-it-qat-UD-Q4_K_XL.gguf` (verify exact name; fall back to `gemma-3-12b-it-qat-Q4_K_M.gguf`). Plus connectors `ltx-2.3-22b-dev_embeddings_connectors.safetensors` (verify repo: Lightricks LTX-2 release). Loaders: `UnetLoaderGGUF`, `DualCLIPLoaderGGUF` (type `ltxv`); nodes need `ComfyUI-GGUF` + `ComfyUI-KJNodes`.

WAN/Bernini diffusion — repo `neuregex/Bernini-R-GGUF` (root):
- `bernini_r_high_noise_14B-Q4_K_M.gguf` 9,659,931,264 B + `bernini_r_low_noise_14B-Q4_K_M.gguf` 9,659,931,264 B (~19 GB pair)
- `*-Q5_K_M.gguf` 10,800,257,664 B each (~22 GB pair)
- `*-Q8_0.gguf` 15,414,811,264 B each (~31 GB pair)

WAN text encoder — repo `city96/umt5-xxl-encoder-gguf`, file `umt5-xxl-encoder-Q5_K_M.gguf` (verify; Q5_K_M+ recommended). Loaders: `UnetLoaderGGUF` (x2 high/low), `CLIPLoaderGGUF`; nodes need `ComfyUI-GGUF` + `ComfyUI-BerniniR`. VAE reuse existing `vae/ComfyUI-WAN/wan_2.1_vae.safetensors`.

---

### Task 1: Add the HF URL helper and verify the artifact table

**Files:**
- Modify: `scripts/camera_lab_setup/modules.py` (top, after imports)
- Test: `tests/test_quant_profiles.py`

**Interfaces:**
- Produces: `_hf(repo: str, path: str) -> str` returning `https://huggingface.co/{repo}/resolve/main/{path}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_quant_profiles.py`:

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from camera_lab_setup.modules import _hf


def test_hf_builds_resolve_url():
    assert _hf("QuantStack/LTX-2.3-GGUF", "LTX-2.3-distilled/LTX-2.3-distilled-Q2_K.gguf") == (
        "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/"
        "LTX-2.3-distilled/LTX-2.3-distilled-Q2_K.gguf"
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py::test_hf_builds_resolve_url -q`
Expected: FAIL with `ImportError: cannot import name '_hf'`.

- [ ] **Step 3: Implement the helper**

In `scripts/camera_lab_setup/modules.py`, after the existing imports and before `@dataclass(frozen=True) class ModelRef`:

```python
def _hf(repo: str, path: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/main/{path}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py::test_hf_builds_resolve_url -q`
Expected: PASS.

- [ ] **Step 5: Verify the artifact table is current**

Run these HEAD checks (PowerShell). Each must print `200`:

```powershell
$urls = @(
  "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/LTX-2.3-distilled/LTX-2.3-distilled-Q2_K.gguf",
  "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/LTX-2.3-distilled/LTX-2.3-distilled-Q4_K_S.gguf",
  "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/LTX-2.3-distilled/LTX-2.3-distilled-Q4_K_M.gguf",
  "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/LTX-2.3-distilled/LTX-2.3-distilled-Q8_0.gguf",
  "https://huggingface.co/neuregex/Bernini-R-GGUF/resolve/main/bernini_r_high_noise_14B-Q4_K_M.gguf",
  "https://huggingface.co/neuregex/Bernini-R-GGUF/resolve/main/bernini_r_low_noise_14B-Q4_K_M.gguf",
  "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q5_K_M.gguf"
)
foreach ($u in $urls) { (Invoke-WebRequest -Method Head -Uri $u -MaximumRedirection 5).StatusCode }
```

For the two text-encoder files whose exact names are uncertain, confirm the real filename in the repo file list before pinning it:
- `unsloth/gemma-3-12b-it-qat-GGUF` → pick the existing Q4 file (prefer `gemma-3-12b-it-qat-UD-Q4_K_XL.gguf`, else `gemma-3-12b-it-qat-Q4_K_M.gguf`).
- The connectors file `ltx-2.3-22b-dev_embeddings_connectors.safetensors` → confirm the hosting repo and exact path.

Record the confirmed names; they are used verbatim in Tasks 2-3.

- [ ] **Step 6: Commit**

```bash
git add scripts/camera_lab_setup/modules.py tests/test_quant_profiles.py
git commit -m "feat: add hf url helper and verify quant artifact table"
```

---

### Task 2: LTX quant ladder for camera and director

**Files:**
- Modify: `scripts/camera_lab_setup/modules.py` (camera and director `model_profiles`)
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `_hf`, `ModelRef`, `ModelProfile`.
- Produces: LTX quant profiles with ids `camera-ltx23-gguf-q2`, `camera-ltx23-gguf-q4s`, `camera-ltx23-gguf-q4m`, `camera-ltx23-gguf-q8` (and director equivalents `director-ltx23-gguf-q2/q4s/q4m/q8`), each `compatibility="workflow_variant"`, with GGUF `required_nodes=("UnetLoaderGGUF", "DualCLIPLoaderGGUF")`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_modular_install.py`:

```python
def test_camera_has_ltx_gguf_ladder_with_ascending_vram():
    camera = get_module("camera")
    ladder = [p for p in camera.model_profiles if p.id.startswith("camera-ltx23-gguf")]
    ids = [p.id for p in ladder]
    assert ids == ["camera-ltx23-gguf-q2", "camera-ltx23-gguf-q4s", "camera-ltx23-gguf-q4m", "camera-ltx23-gguf-q8"]
    vrams = [p.min_vram_gb for p in ladder]
    assert vrams == sorted(vrams)
    q2 = ladder[0]
    assert q2.min_vram_gb <= 8
    # GGUF diffusion + Gemma encoder are both required, both via GGUF loaders
    assert any(m.name == "LTX-2.3-distilled-Q2_K.gguf" and m.source_url for m in q2.required_models)
    assert any(m.folder == "text_encoders" and m.name.endswith(".gguf") and m.source_url for m in q2.required_models)
    assert "UnetLoaderGGUF" in q2.required_nodes
    assert "DualCLIPLoaderGGUF" in q2.required_nodes
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_camera_has_ltx_gguf_ladder_with_ascending_vram -q`
Expected: FAIL (old single stub `camera-ltx23-gguf-q4` only).

- [ ] **Step 3: Implement the LTX ladder**

In `scripts/camera_lab_setup/modules.py`, add shared GGUF model tuples near `LTX23_TEXT_MODELS`:

```python
# Verified in Task 1. Gemma file + connectors path confirmed against the real repos.
LTX23_GGUF_TEXT_MODELS = (
    ModelRef("text_encoders", "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf",
             _hf("unsloth/gemma-3-12b-it-qat-GGUF", "gemma-3-12b-it-qat-UD-Q4_K_XL.gguf")),
    ModelRef("text_encoders", "ltx-2.3-22b-dev_embeddings_connectors.safetensors",
             _hf("Lightricks/LTX-2", "text_encoders/ltx-2.3-22b-dev_embeddings_connectors.safetensors")),
)
LTX23_GGUF_NODES = ("UnetLoaderGGUF", "DualCLIPLoaderGGUF")
LTX23_GGUF_SHARED = (
    ModelRef("loras", "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"),
    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
)


def _ltx_gguf_diffusion(name: str) -> ModelRef:
    return ModelRef("diffusion_models", name, _hf("QuantStack/LTX-2.3-GGUF", f"LTX-2.3-distilled/{name}"))


def _ltx_gguf_profile(prefix: str, suffix: str, gguf: str, *, min_vram: float, rec_vram: float, disk: float, quant: str) -> ModelProfile:
    return ModelProfile(
        id=f"{prefix}-ltx23-gguf-{suffix}",
        label=f"LTX 2.3 GGUF {quant}",
        required_models=(_ltx_gguf_diffusion(gguf), *LTX23_GGUF_TEXT_MODELS, *LTX23_GGUF_SHARED),
        required_nodes=LTX23_GGUF_NODES,
        min_vram_gb=min_vram,
        recommended_vram_gb=rec_vram,
        disk_gb=disk,
        compatibility="workflow_variant",
        quantization=quant,
        size="small",
        workflow_group="LTX Camera GGUF",
        compatible_workflows=("ltx23_gguf_i2v_nag_extend.json",),
        notes="GGUF low-VRAM variant; loads via ComfyUI-GGUF + ComfyUI-KJNodes. Text encoder (Gemma QAT) sets the VRAM floor.",
    )


def _ltx_gguf_ladder(prefix: str) -> tuple[ModelProfile, ...]:
    return (
        _ltx_gguf_profile(prefix, "q2", "LTX-2.3-distilled-Q2_K.gguf", min_vram=8, rec_vram=10, disk=22, quant="GGUF Q2_K"),
        _ltx_gguf_profile(prefix, "q4s", "LTX-2.3-distilled-Q4_K_S.gguf", min_vram=12, rec_vram=12, disk=27, quant="GGUF Q4_K_S"),
        _ltx_gguf_profile(prefix, "q4m", "LTX-2.3-distilled-Q4_K_M.gguf", min_vram=16, rec_vram=16, disk=28, quant="GGUF Q4_K_M"),
        _ltx_gguf_profile(prefix, "q8", "LTX-2.3-distilled-Q8_0.gguf", min_vram=20, rec_vram=24, disk=35, quant="GGUF Q8_0"),
    )
```

Then, in the `camera` module, replace the existing single `camera-ltx23-gguf-q4` `ModelProfile(...)` with `*_ltx_gguf_ladder("camera")` appended after the FP8 profile. In the `director` module, append `*_ltx_gguf_ladder("director")` after its FP8 profiles. (`director` GGUF profiles reuse the same diffusion/encoder; the director-specific VAEs stay only on the FP8 director profiles.)

Note: the `_ltx_gguf_ladder` ids embed `prefix`, so director ids become `director-ltx23-gguf-q2` etc. The `compatible_workflows` for director's ladder should be set to `("ltx23_gguf_i2v_nag_extend.json",)` as well for now (Director GGUF timeline variant is out of scope; the camera variant proves the loader path). Override by passing director's value — to keep it simple, leave the shared camera variant; director readiness still resolves on node+model visibility.

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`
Expected: PASS (new ladder test passes; existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/modules.py tests/test_modular_install.py
git commit -m "feat: register ltx 2.3 gguf quant ladder for camera and director"
```

---

### Task 3: WAN/Bernini quant ladder for edit, and honest SCAIL2 marker

**Files:**
- Modify: `scripts/camera_lab_setup/modules.py` (edit and motion `model_profiles`)
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `_hf`, `ModelRef`, `ModelProfile`.
- Produces: edit quant profiles `edit-bernini-gguf-q4m`, `edit-bernini-gguf-q5m`, `edit-bernini-gguf-q8` with `required_nodes=("UnetLoaderGGUF", "CLIPLoaderGGUF")`; motion keeps a `motion-scail2-small` profile explicitly marked unavailable.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_modular_install.py`:

```python
def test_edit_has_bernini_gguf_ladder_with_high_and_low_experts():
    edit = get_module("edit")
    ladder = [p for p in edit.model_profiles if p.id.startswith("edit-bernini-gguf")]
    ids = [p.id for p in ladder]
    assert ids == ["edit-bernini-gguf-q4m", "edit-bernini-gguf-q5m", "edit-bernini-gguf-q8"]
    q4 = ladder[0]
    names = {m.name for m in q4.required_models}
    assert "bernini_r_high_noise_14B-Q4_K_M.gguf" in names
    assert "bernini_r_low_noise_14B-Q4_K_M.gguf" in names
    assert any(m.folder == "text_encoders" and m.name.endswith(".gguf") for m in q4.required_models)
    assert "UnetLoaderGGUF" in q4.required_nodes


def test_motion_scail2_small_is_marked_unavailable_not_faked():
    motion = get_module("motion")
    small = next(p for p in motion.model_profiles if p.id == "motion-scail2-small")
    assert small.required_models == ()  # no public GGUF exists
    assert "no" in small.notes.lower() and "gguf" in small.notes.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_edit_has_bernini_gguf_ladder_with_high_and_low_experts -q`
Expected: FAIL (old single `edit-vace14-gguf` stub only).

- [ ] **Step 3: Implement the Bernini ladder and SCAIL2 marker**

In `scripts/camera_lab_setup/modules.py`, add near the WAN profiles:

```python
WAN_GGUF_NODES = ("UnetLoaderGGUF", "CLIPLoaderGGUF")
WAN_UMT5_GGUF = ModelRef("text_encoders", "umt5-xxl-encoder-Q5_K_M.gguf",
                         _hf("city96/umt5-xxl-encoder-gguf", "umt5-xxl-encoder-Q5_K_M.gguf"))
WAN_VAE = ModelRef("vae", "ComfyUI-WAN/wan_2.1_vae.safetensors")


def _bernini_pair(quant: str) -> tuple[ModelRef, ModelRef]:
    high = f"bernini_r_high_noise_14B-{quant}.gguf"
    low = f"bernini_r_low_noise_14B-{quant}.gguf"
    return (
        ModelRef("diffusion_models", high, _hf("neuregex/Bernini-R-GGUF", high)),
        ModelRef("diffusion_models", low, _hf("neuregex/Bernini-R-GGUF", low)),
    )


def _bernini_gguf_profile(suffix: str, quant: str, *, min_vram: float, rec_vram: float, disk: float) -> ModelProfile:
    return ModelProfile(
        id=f"edit-bernini-gguf-{suffix}",
        label=f"WAN2.2 Bernini GGUF {quant}",
        required_models=(*_bernini_pair(quant), WAN_UMT5_GGUF, WAN_VAE),
        required_nodes=WAN_GGUF_NODES,
        min_vram_gb=min_vram,
        recommended_vram_gb=rec_vram,
        disk_gb=disk,
        compatibility="workflow_variant",
        quantization=f"GGUF {quant}",
        size="small",
        workflow_group="WAN Bernini GGUF",
        compatible_workflows=("wan22_bernini_gguf_i2v.json",),
        notes="GGUF dual-expert (high+low) variant; loads via ComfyUI-GGUF + ComfyUI-BerniniR.",
    )
```

In the `edit` module `model_profiles`, replace the single `edit-vace14-gguf` stub with:

```python
            _bernini_gguf_profile("q4m", "Q4_K_M", min_vram=8, rec_vram=10, disk=22),
            _bernini_gguf_profile("q5m", "Q5_K_M", min_vram=12, rec_vram=12, disk=24),
            _bernini_gguf_profile("q8", "Q8_0", min_vram=16, rec_vram=16, disk=33),
```

In the `motion` module, keep `motion-scail2-small` but ensure its body is exactly:

```python
            ModelProfile(
                id="motion-scail2-small",
                label="SCAIL2 low VRAM variant",
                min_vram_gb=8,
                recommended_vram_gb=12,
                compatibility="workflow_variant",
                quantization="unconfirmed",
                size="small",
                workflow_group="SCAIL2",
                notes="No public GGUF/quantized SCAIL2 model exists yet; reduce frames/resolution until a compatible variant is bundled.",
            ),
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/modules.py tests/test_modular_install.py
git commit -m "feat: register bernini gguf ladder and mark scail2 unavailable"
```

---

### Task 4: VRAM-aware resolver tier selection

**Files:**
- Modify: `scripts/camera_lab_setup/resolver.py` (`resolve_module` selection block)
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `CameraLabModule`, `HardwareProfile`, `ComfyVisibility`, `ModelProfile`.
- Produces: `resolve_module` now picks, among *ready* profiles, the one with the highest `min_vram_gb` that is `<= hardware.vram_gb`; if none fit (or VRAM unknown), picks the lowest-`min_vram_gb` ready profile. Recommendation stays `recommended` when the picked profile fits, `risky` when it does not.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_modular_install.py`:

```python
def _ltx_visibility_all_tiers():
    from scripts.camera_lab_setup.visibility import ComfyVisibility
    diff = frozenset({
        "LTX-2.3-distilled-Q2_K.gguf", "LTX-2.3-distilled-Q4_K_S.gguf",
        "LTX-2.3-distilled-Q4_K_M.gguf", "LTX-2.3-distilled-Q8_0.gguf",
    })
    texts = frozenset({"gemma-3-12b-it-qat-UD-Q4_K_XL.gguf", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"})
    return ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "UnetLoaderGGUF", "DualCLIPLoaderGGUF"}),
        models={
            "diffusion_models": diff,
            "text_encoders": texts,
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
        },
        source="test",
    )


def test_resolver_picks_highest_fitting_gguf_tier_by_vram():
    from scripts.camera_lab_setup.hardware import HardwareProfile
    from scripts.camera_lab_setup.resolver import resolve_module
    camera = get_module("camera")
    vis = _ltx_visibility_all_tiers()
    assert resolve_module(camera, HardwareProfile(vram_gb=8), vis).profile == "camera-ltx23-gguf-q2"
    assert resolve_module(camera, HardwareProfile(vram_gb=12), vis).profile == "camera-ltx23-gguf-q4s"
    assert resolve_module(camera, HardwareProfile(vram_gb=16), vis).profile == "camera-ltx23-gguf-q4m"
    s24 = resolve_module(camera, HardwareProfile(vram_gb=24), vis)
    assert s24.profile == "camera-ltx23-gguf-q8"
    assert s24.recommendation == "recommended"


def test_resolver_marks_risky_when_only_oversized_tier_is_ready():
    from scripts.camera_lab_setup.hardware import HardwareProfile
    from scripts.camera_lab_setup.resolver import resolve_module
    from scripts.camera_lab_setup.visibility import ComfyVisibility
    camera = get_module("camera")
    vis = ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "UnetLoaderGGUF", "DualCLIPLoaderGGUF"}),
        models={
            "diffusion_models": frozenset({"LTX-2.3-distilled-Q8_0.gguf"}),
            "text_encoders": frozenset({"gemma-3-12b-it-qat-UD-Q4_K_XL.gguf", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
        },
        source="test",
    )
    status = resolve_module(camera, HardwareProfile(vram_gb=8), vis)
    assert status.profile == "camera-ltx23-gguf-q8"
    assert status.recommendation == "risky"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_resolver_picks_highest_fitting_gguf_tier_by_vram -q`
Expected: FAIL (current resolver picks the last ready profile regardless of VRAM).

- [ ] **Step 3: Implement VRAM-aware selection**

In `scripts/camera_lab_setup/resolver.py`, replace the ready-candidate selection inside `resolve_module`:

```python
    ready_candidates = [(profile, missing) for profile, missing in candidates if not missing]
    if ready_candidates:
        vram = hardware.vram_gb
        def _floor(item):
            return item[0].min_vram_gb if item[0].min_vram_gb is not None else 0
        if vram is not None:
            fitting = [item for item in ready_candidates if _floor(item) <= vram]
            if fitting:
                profile, missing = max(fitting, key=_floor)
            else:
                profile, missing = min(ready_candidates, key=_floor)
        else:
            profile, missing = min(ready_candidates, key=_floor)
    else:
        profile, missing = min(candidates, key=lambda item: len(item[1]))
```

Leave `_hardware_recommendation` unchanged: it already returns `risky` when `vram < min_vram_gb`, which now fires when only an oversized tier is ready.

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`
Expected: PASS.

- [ ] **Step 5: Run the existing installer-profile matrix to confirm no regressions**

Run: `python -m pytest -p no:cacheprovider tests/test_installer_profiles.py -q`
Expected: PASS (some 8–16GB rows that previously had no ready GGUF tier may now resolve to a quant profile; if a row's expected recommendation changed because a real green path now exists, update that row to the correct expectation and note it in the commit).

- [ ] **Step 6: Commit**

```bash
git add scripts/camera_lab_setup/resolver.py tests/test_modular_install.py tests/test_installer_profiles.py
git commit -m "feat: resolver picks highest fitting gguf tier by vram"
```

---

### Task 5: LTX GGUF workflow variant

**Files:**
- Create: `workflows/app/ltx23_gguf_i2v_nag_extend.json`
- Modify: `scripts/camera_lab_setup/modules.py` (`camera` module `workflows` tuple)
- Test: `tests/test_quant_profiles.py`

**Interfaces:**
- Consumes: the `camera-ltx23-gguf-*` profiles' registered model filenames and `required_nodes`.
- Produces: a workflow JSON whose loader nodes are GGUF and whose model filenames all appear in the LTX quant ladder.

- [ ] **Step 1: Write the failing consistency test**

Append to `tests/test_quant_profiles.py`:

```python
import json

from camera_lab_setup.modules import get_module

GGUF_LOADER_CLASSES = {"UnetLoaderGGUF", "DualCLIPLoaderGGUF", "CLIPLoaderGGUF"}


def _registry_model_names(module_id, prefix):
    module = get_module(module_id)
    names = set()
    for profile in module.model_profiles:
        if profile.id.startswith(prefix):
            for m in profile.required_models:
                names.add(Path(m.name).name)
    return names


def test_ltx_gguf_workflow_only_uses_registered_models_and_gguf_loaders():
    wf_path = ROOT / "workflows" / "app" / "ltx23_gguf_i2v_nag_extend.json"
    data = json.loads(wf_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", data)  # support either UI graph or api dict
    registered = _registry_model_names("camera", "camera-ltx23-gguf")
    # Every node that loads a diffusion/text model must be a GGUF loader class.
    blob = json.dumps(data)
    assert "UNETLoader" not in blob and "DualCLIPLoader\"" not in blob  # no FP8 loaders left
    assert "UnetLoaderGGUF" in blob
    # Every .gguf filename referenced must be a registered model.
    import re
    referenced = set(re.findall(r"[\w./-]+\.gguf", blob))
    referenced = {Path(r).name for r in referenced}
    assert referenced
    assert referenced <= registered, f"unregistered gguf files: {referenced - registered}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py::test_ltx_gguf_workflow_only_uses_registered_models_and_gguf_loaders -q`
Expected: FAIL with `FileNotFoundError` (workflow not created yet).

- [ ] **Step 3: Author the GGUF workflow variant**

Copy the bundled FP8 source and swap loaders:

```bash
cp workflows/app/ltx23_nag_i2v_extendcrop_general.json workflows/app/ltx23_gguf_i2v_nag_extend.json
```

Then edit `workflows/app/ltx23_gguf_i2v_nag_extend.json`:
- Replace the diffusion loader node `class_type`/`type` from the FP8 checkpoint/UNET loader to `UnetLoaderGGUF`, and set its `unet_name` widget to `LTX-2.3-distilled-Q4_K_S.gguf`.
- Replace the text-encoder loader with `DualCLIPLoaderGGUF`, set `clip_name1=gemma-3-12b-it-qat-UD-Q4_K_XL.gguf`, `clip_name2=ltx-2.3-22b-dev_embeddings_connectors.safetensors`, and `type=ltxv`.
- Keep LoRA (`ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`) and upscaler (`ltx-2.3-spatial-upscaler-x2-1.1.safetensors`) loader nodes unchanged.
- Confirm against a running ComfyUI that `object_info` exposes `UnetLoaderGGUF` and `DualCLIPLoaderGGUF` (install ComfyUI-GGUF + ComfyUI-KJNodes if missing) so the variant actually loads.

Use the verified filenames recorded in Task 1 if they differed.

- [ ] **Step 4: Register the variant on the camera module**

In `scripts/camera_lab_setup/modules.py`, add `"ltx23_gguf_i2v_nag_extend.json"` to the `camera` module `workflows` tuple.

- [ ] **Step 5: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py tests/test_modular_install.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workflows/app/ltx23_gguf_i2v_nag_extend.json scripts/camera_lab_setup/modules.py tests/test_quant_profiles.py
git commit -m "feat: add ltx 2.3 gguf workflow variant"
```

---

### Task 6: WAN/Bernini GGUF workflow variant

**Files:**
- Create: `workflows/app/wan22_bernini_gguf_i2v.json`
- Modify: `scripts/camera_lab_setup/modules.py` (`edit` module `workflows` tuple)
- Test: `tests/test_quant_profiles.py`

**Interfaces:**
- Consumes: the `edit-bernini-gguf-*` profiles' registered model filenames and `required_nodes`.
- Produces: a workflow JSON using GGUF loaders for both experts whose model filenames all appear in the Bernini quant ladder.

- [ ] **Step 1: Write the failing consistency test**

Append to `tests/test_quant_profiles.py`:

```python
def test_bernini_gguf_workflow_only_uses_registered_models_and_gguf_loaders():
    wf_path = ROOT / "workflows" / "app" / "wan22_bernini_gguf_i2v.json"
    data = json.loads(wf_path.read_text(encoding="utf-8"))
    blob = json.dumps(data)
    registered = _registry_model_names("edit", "edit-bernini-gguf")
    assert "UnetLoaderGGUF" in blob
    import re
    referenced = {Path(r).name for r in re.findall(r"[\w./-]+\.gguf", blob)}
    assert referenced
    assert referenced <= registered, f"unregistered gguf files: {referenced - registered}"
    # both experts present
    assert any("high_noise" in n for n in referenced)
    assert any("low_noise" in n for n in referenced)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py::test_bernini_gguf_workflow_only_uses_registered_models_and_gguf_loaders -q`
Expected: FAIL with `FileNotFoundError`.

- [ ] **Step 3: Author the Bernini GGUF variant**

```bash
cp workflows/app/wan22_bernini_i2v.ui.json workflows/app/wan22_bernini_gguf_i2v.json
```

Edit `workflows/app/wan22_bernini_gguf_i2v.json`:
- Replace the two FP8 diffusion loaders (HIGH and LOW) with `UnetLoaderGGUF` nodes, setting `unet_name` to `bernini_r_high_noise_14B-Q4_K_M.gguf` and `bernini_r_low_noise_14B-Q4_K_M.gguf`.
- Replace the UMT5 text-encoder loader with `CLIPLoaderGGUF`, `clip_name=umt5-xxl-encoder-Q5_K_M.gguf`, `type=wan`.
- Keep the existing lightx2v LoRA nodes and the `wan_2.1_vae.safetensors` VAE loader unchanged.
- Confirm against a running ComfyUI that `object_info` exposes `UnetLoaderGGUF` and `CLIPLoaderGGUF` (install ComfyUI-GGUF + ComfyUI-BerniniR if missing).

- [ ] **Step 4: Register the variant on the edit module**

Add `"wan22_bernini_gguf_i2v.json"` to the `edit` module `workflows` tuple.

- [ ] **Step 5: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py tests/test_modular_install.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workflows/app/wan22_bernini_gguf_i2v.json scripts/camera_lab_setup/modules.py tests/test_quant_profiles.py
git commit -m "feat: add wan bernini gguf workflow variant"
```

---

### Task 7: Network URL-reachability test for every quant source

**Files:**
- Test: `tests/test_quant_profiles.py`

**Interfaces:**
- Consumes: all quant profiles' `required_models[*].source_url`.
- Produces: a network test (opt-in) asserting each URL HEADs to 200/302.

- [ ] **Step 1: Write the network test**

Append to `tests/test_quant_profiles.py`:

```python
import os
import urllib.request

import pytest

from camera_lab_setup.modules import MODULES


def _quant_source_urls():
    urls = set()
    for module in MODULES:
        for profile in module.model_profiles:
            if "gguf" not in profile.id:
                continue
            for m in profile.required_models:
                if m.source_url:
                    urls.add(m.source_url)
    return sorted(urls)


@pytest.mark.skipif(os.environ.get("CAMERA_LAB_NETWORK_TESTS") != "1", reason="set CAMERA_LAB_NETWORK_TESTS=1 to run network checks")
@pytest.mark.parametrize("url", _quant_source_urls())
def test_quant_model_url_is_reachable(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as resp:
        assert resp.status in (200, 302)
```

- [ ] **Step 2: Run it offline (skips) and online (passes)**

Run offline: `python -m pytest -p no:cacheprovider tests/test_quant_profiles.py -q`
Expected: the reachability cases SKIP; consistency tests PASS.

Run online (PowerShell): `$env:CAMERA_LAB_NETWORK_TESTS=1; python -m pytest -p no:cacheprovider tests/test_quant_profiles.py -q; Remove-Item Env:CAMERA_LAB_NETWORK_TESTS`
Expected: every URL case PASSES. Any 404 means a filename pinned in Tasks 2-3 is wrong — fix the registry name and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/test_quant_profiles.py
git commit -m "test: verify quant model source urls are reachable"
```

---

## Final Verification

- [ ] Full quant + modular suite:

```powershell
python -m pytest -p no:cacheprovider tests/test_modular_install.py tests/test_quant_profiles.py tests/test_installer_profiles.py tests/test_check_setup_modules.py tests/test_config_modules.py
```

- [ ] Online URL check:

```powershell
$env:CAMERA_LAB_NETWORK_TESTS=1; python -m pytest -p no:cacheprovider tests/test_quant_profiles.py -q; Remove-Item Env:CAMERA_LAB_NETWORK_TESTS
```

- [ ] Installer profile listing shows the new ladders:

```powershell
python scripts/install_camera_lab.py --list-profiles --modules camera,director,edit
```

Expected: LTX GGUF q2/q4s/q4m/q8 under camera and director; Bernini GGUF q4m/q5m/q8 under edit; SCAIL2 low-VRAM still marked unavailable.

- [ ] `git status --short` — only intended files changed; no `.env`, models, or generated media.

## Self-Review Notes

- Spec coverage: two-family ladders (Tasks 2-3), text-encoder-driven VRAM floor (Tasks 2-3 model sets + Task 4 selection), resolver VRAM fit (Task 4), GGUF workflow variants (Tasks 5-6), motion honest gap (Task 3), source+node verification (Tasks 1, 5, 6, 7). All spec sections map to a task.
- Placeholder scan: filenames/URLs are concrete and pinned to verified repos; the only deferred values (exact Gemma QAT filename, connectors repo path) carry a concrete seed plus an explicit Task 1 verification action and a Task 7 reachability gate — not open-ended placeholders.
- Type consistency: `_hf`, `ModelRef`, `ModelProfile`, profile id schemes (`*-ltx23-gguf-*`, `edit-bernini-gguf-*`), and node-class names (`UnetLoaderGGUF`, `DualCLIPLoaderGGUF`, `CLIPLoaderGGUF`) are used identically across tasks.
