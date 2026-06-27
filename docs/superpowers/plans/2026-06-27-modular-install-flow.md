# Modular Install Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hardware-aware modular installer that recommends Camera Lab modules and model profiles, installs selected workflows, reports module readiness, and lets the frontend grey out unavailable workspace tabs.

**Architecture:** Add a focused setup package under `scripts/camera_lab_setup/` for module metadata, hardware detection, model visibility, and install resolution. Keep existing scripts as compatibility wrappers around the new shared code. Expose module status through `/api/config` and apply it in `frontend/app.js` without changing generation behavior.

**Tech Stack:** Python 3.10+, stdlib dataclasses/argparse/urllib, existing ComfyUI `/object_info`, static JavaScript frontend, pytest, Playwright smoke tests.

## Global Constraints

- Preserve existing commands: `python scripts/agent_setup.py`, `python scripts/install_workflows.py`, and `python scripts/check_setup.py`.
- Do not install ComfyUI, model weights, or third-party custom nodes automatically.
- Prefer ComfyUI `/object_info` for model visibility because it includes `extra_model_paths.yaml`.
- Continue repo-side setup when ComfyUI or hardware facts are unavailable.
- Keep frontend tabs visible but disabled and greyed out when their module is disabled or not ready; direct hashes must redirect to a ready workspace.
- Keep first installer as CLI: `python scripts/install_camera_lab.py`.

---

## File Structure

- Create `scripts/camera_lab_setup/__init__.py`: package marker.
- Create `scripts/camera_lab_setup/modules.py`: module registry, dataclasses, workflow mapping, model profiles.
- Create `scripts/camera_lab_setup/hardware.py`: hardware profile detection from injected probes.
- Create `scripts/camera_lab_setup/visibility.py`: model/node visibility from `/object_info` or filesystem fallback.
- Create `scripts/camera_lab_setup/resolver.py`: module/profile recommendation and readiness calculation.
- Create `scripts/install_camera_lab.py`: CLI installer entry point.
- Modify `scripts/camera_lab_common.py`: delegate workflow source selection and setup helpers to registry where useful.
- Modify `scripts/install_workflows.py`: add `--modules` while keeping `--include-experimental`.
- Modify `scripts/agent_setup.py`: call the new module-aware workflow install path.
- Modify `scripts/check_setup.py`: module-aware checks and `/object_info` model visibility.
- Modify `server/camera_lab_server.py`: include module status in `/api/config`.
- Modify `frontend/app.js`: disable and grey out unavailable workspace tabs and redirect hashes.
- Modify `README.md`: document the new installer.
- Test with `tests/test_modular_install.py`, `tests/test_check_setup_modules.py`, `tests/test_config_modules.py`, and `tests/e2e/home.spec.js`.

---

### Task 1: Module Registry And Model Profiles

**Files:**
- Create: `scripts/camera_lab_setup/__init__.py`
- Create: `scripts/camera_lab_setup/modules.py`
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Produces: `ModelRef(folder: str, name: str)`, `ModelProfile`, `CameraLabModule`, `MODULES`, `module_ids()`, `get_module(module_id: str)`, `selected_modules(module_ids: Iterable[str] | None)`.
- Later tasks consume `MODULES` and each module's `workflows`, `required_nodes`, `model_profiles`, and `frontend_workspace`.

- [ ] **Step 1: Write failing tests for the module registry**

Add `tests/test_modular_install.py`:

```python
from scripts.camera_lab_setup.modules import MODULES, get_module, module_ids, selected_modules


def test_module_registry_contains_user_facing_workspaces():
    assert module_ids() == ["camera", "director", "edit", "casting", "motion"]
    assert get_module("director").label == "Director"
    assert get_module("director").frontend_workspace == "director"


def test_director_profiles_include_v1_and_v2_models():
    director = get_module("director")
    profile_ids = {profile.id for profile in director.model_profiles}
    assert {"director-v1-ltx23-fp8", "director-v2-distilled-fp8"} <= profile_ids
    v2 = next(profile for profile in director.model_profiles if profile.id == "director-v2-distilled-fp8")
    assert any(model.folder == "diffusion_models" and model.name == "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors" for model in v2.required_models)


def test_selected_modules_preserves_registry_order_and_rejects_unknown_ids():
    assert [module.id for module in selected_modules(["motion", "camera"])] == ["camera", "motion"]
    try:
        selected_modules(["camera", "unknown"])
    except ValueError as exc:
        assert "unknown module: unknown" in str(exc)
    else:
        raise AssertionError("unknown module id should fail")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.camera_lab_setup'`.

- [ ] **Step 3: Create the registry implementation**

Create `scripts/camera_lab_setup/__init__.py`:

```python
"""Setup and installation helpers for Camera Lab."""
```

Create `scripts/camera_lab_setup/modules.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class ModelRef:
    folder: str
    name: str


@dataclass(frozen=True)
class ModelProfile:
    id: str
    label: str
    required_models: tuple[ModelRef, ...] = ()
    required_nodes: tuple[str, ...] = ()
    min_vram_gb: float | None = None
    recommended_vram_gb: float | None = None
    disk_gb: float = 0.0
    features: tuple[str, ...] = ()


@dataclass(frozen=True)
class CameraLabModule:
    id: str
    label: str
    description: str
    workflows: tuple[str, ...]
    frontend_workspace: str
    required_nodes: tuple[str, ...] = ()
    model_profiles: tuple[ModelProfile, ...] = ()
    optional_nodes: tuple[str, ...] = ()
    optional_models: tuple[ModelRef, ...] = ()


LTX23_TEXT_MODELS = (
    ModelRef("text_encoders", "gemma_3_12B_it_fp4_mixed.safetensors"),
    ModelRef("text_encoders", "ltx-2.3_text_projection_bf16.safetensors"),
)

MODULES: tuple[CameraLabModule, ...] = (
    CameraLabModule(
        id="camera",
        label="Camera Lab",
        description="Standard LTX image/video generation workflows.",
        frontend_workspace="camera",
        workflows=(
            "ltx23_nag_i2v_extendcrop_general.json",
            "ltx23_nag_ia2v_extendcrop_general.json",
            "ltx23_flf_ia2v_nag_extend.json",
            "ltx23_flf_subtitle_cleaner_nag_extend.json",
            "ltx23_i2v_subtitle_cleaner_nag_extend.json",
            "LTX-2.3_FML2V_RuneXX_guider.local.json",
        ),
        required_nodes=("LTXVConditioning",),
        model_profiles=(
            ModelProfile(
                id="camera-ltx23-fp8",
                label="LTX 2.3 FP8",
                required_models=(
                    ModelRef("checkpoints", "ltx-2.3-22b-dev-fp8.safetensors"),
                    ModelRef("loras", "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=39,
            ),
        ),
    ),
    CameraLabModule(
        id="director",
        label="Director",
        description="Timeline assembly with LTX Director workflows.",
        frontend_workspace="director",
        workflows=("ltx_director_reference_mvp.json",),
        required_nodes=("LTXDirector", "LTXDirectorGuide"),
        model_profiles=(
            ModelProfile(
                id="director-v1-ltx23-fp8",
                label="Director v1 LTX 2.3 FP8",
                required_models=(
                    ModelRef("checkpoints", "ltx-2.3-22b-dev-fp8.safetensors"),
                    ModelRef("loras", "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    ModelRef("vae", "LTX23_audio_vae_bf16.safetensors"),
                    ModelRef("vae", "LTX23_video_vae_bf16.safetensors"),
                    ModelRef("vae", "taeltx2_3.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=42,
            ),
            ModelProfile(
                id="director-v2-distilled-fp8",
                label="Director v2 Distilled FP8",
                required_nodes=("LTXDirectorCropGuides",),
                required_models=(
                    ModelRef("diffusion_models", "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    ModelRef("vae", "LTX23_audio_vae_bf16.safetensors"),
                    ModelRef("vae", "LTX23_video_vae_bf16.safetensors"),
                    ModelRef("vae", "taeltx2_3.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=36,
                features=("timeline-video", "audio-inpaint"),
            ),
        ),
    ),
    CameraLabModule(
        id="edit",
        label="Edit",
        description="WAN Bernini and VACE Inpaint workflows.",
        frontend_workspace="edit",
        workflows=(
            "wan22_bernini_t2v.ui.json",
            "wan22_bernini_i2v.ui.json",
            "wan22_bernini_v2v.ui.json",
            "wan22_bernini_mv2v.ui.json",
            "wan22_bernini_vi2v.ui.json",
            "wan22_bernini_vrc2v.ui.json",
            "wan22_bernini_r2v.ui.json",
            "wan22_bernini_rv2v.ui.json",
            "wan22_bernini_ads2v.ui.json",
            "wan_vace_inpainting.ui.json",
        ),
        model_profiles=(ModelProfile(id="edit-existing-wan", label="Existing WAN models", min_vram_gb=16, recommended_vram_gb=24),),
    ),
    CameraLabModule(
        id="casting",
        label="Casting",
        description="Script, voice library, and optional TTS preparation.",
        frontend_workspace="casting",
        workflows=(),
        model_profiles=(ModelProfile(id="casting-local", label="Local voice library"),),
    ),
    CameraLabModule(
        id="motion",
        label="Motion",
        description="Text to Motion, SCAIL2, and 3D Motion workflows.",
        frontend_workspace="motion",
        workflows=("hymotion_guide.api.json", "hymotion_guide.ui.json", "scail2_video.api.json"),
        required_nodes=("HYMotionGenerate",),
        model_profiles=(ModelProfile(id="motion-existing-scail", label="Existing HY-Motion/SCAIL2 models", min_vram_gb=16, recommended_vram_gb=24),),
    ),
)


def module_ids() -> list[str]:
    return [module.id for module in MODULES]


def get_module(module_id: str) -> CameraLabModule:
    for module in MODULES:
        if module.id == module_id:
            return module
    raise ValueError(f"unknown module: {module_id}")


def selected_modules(ids: Iterable[str] | None = None) -> list[CameraLabModule]:
    if ids is None:
        return list(MODULES)
    requested = {str(item).strip() for item in ids if str(item).strip()}
    for module_id in requested:
        get_module(module_id)
    return [module for module in MODULES if module.id in requested]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/__init__.py scripts/camera_lab_setup/modules.py tests/test_modular_install.py
git commit -m "feat: add modular setup registry"
```

---

### Task 2: Hardware Profile Detection

**Files:**
- Create: `scripts/camera_lab_setup/hardware.py`
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: no registry types.
- Produces: `HardwareProfile`, `detect_hardware(nvidia_smi=None, disk_usage=None, platform_name=None, python_version=None) -> HardwareProfile`.
- Later tasks use `HardwareProfile.vram_gb`, `ram_gb`, and `warnings`.

- [ ] **Step 1: Add failing tests for hardware parsing**

Append to `tests/test_modular_install.py`:

```python
from scripts.camera_lab_setup.hardware import detect_hardware


def test_detect_hardware_parses_nvidia_smi_csv():
    def fake_nvidia_smi():
        return "NVIDIA GeForce RTX 4090, 24564\n"

    profile = detect_hardware(nvidia_smi=fake_nvidia_smi, disk_usage=lambda path: (100, 40, 60), platform_name="Windows", python_version="3.12.7")

    assert profile.gpu_name == "NVIDIA GeForce RTX 4090"
    assert profile.vram_gb == 24
    assert profile.os_name == "Windows"
    assert profile.python_version == "3.12.7"


def test_detect_hardware_keeps_unknown_gpu_as_warning():
    profile = detect_hardware(nvidia_smi=lambda: "", disk_usage=lambda path: (100, 40, 60), platform_name="Linux", python_version="3.11")

    assert profile.gpu_name is None
    assert "GPU VRAM could not be detected" in profile.warnings
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_detect_hardware_parses_nvidia_smi_csv -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.camera_lab_setup.hardware'`.

- [ ] **Step 3: Implement hardware detection**

Create `scripts/camera_lab_setup/hardware.py`:

```python
from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class HardwareProfile:
    gpu_name: str | None = None
    vram_gb: int | None = None
    ram_gb: int | None = None
    os_name: str = ""
    python_version: str = ""
    repo_free_gb: int | None = None
    comfy_free_gb: int | None = None
    cuda_available: bool | None = None
    warnings: tuple[str, ...] = field(default_factory=tuple)


def default_nvidia_smi() -> str:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return ""
    result = subprocess.run(
        [exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else ""


def parse_nvidia_smi(output: str) -> tuple[str | None, int | None]:
    first = next((line.strip() for line in output.splitlines() if line.strip()), "")
    if not first or "," not in first:
        return None, None
    name, raw_mb = [part.strip() for part in first.split(",", 1)]
    try:
        vram_gb = round(int(raw_mb) / 1024)
    except ValueError:
        vram_gb = None
    return name or None, vram_gb


def detect_hardware(
    *,
    nvidia_smi: Callable[[], str] | None = None,
    disk_usage: Callable[[str | Path], tuple[int, int, int]] | None = None,
    platform_name: str | None = None,
    python_version: str | None = None,
    repo_root: Path | None = None,
    comfy_root: Path | None = None,
) -> HardwareProfile:
    warnings: list[str] = []
    gpu_name, vram_gb = parse_nvidia_smi((nvidia_smi or default_nvidia_smi)())
    if vram_gb is None:
        warnings.append("GPU VRAM could not be detected")
    disk_usage = disk_usage or shutil.disk_usage
    repo_free_gb = None
    comfy_free_gb = None
    if repo_root:
        repo_free_gb = round(disk_usage(repo_root)[2] / (1024 ** 3))
    if comfy_root:
        comfy_free_gb = round(disk_usage(comfy_root)[2] / (1024 ** 3))
    return HardwareProfile(
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        os_name=platform_name or platform.system(),
        python_version=python_version or sys.version.split()[0],
        repo_free_gb=repo_free_gb,
        comfy_free_gb=comfy_free_gb,
        warnings=tuple(warnings),
    )
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/hardware.py tests/test_modular_install.py
git commit -m "feat: detect setup hardware profile"
```

---

### Task 3: Model And Node Visibility

**Files:**
- Create: `scripts/camera_lab_setup/visibility.py`
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `ModelRef`.
- Produces: `ComfyVisibility(nodes: frozenset[str], models: Mapping[str, frozenset[str]], source: str)`, `visibility_from_object_info(object_info: Mapping[str, Any])`, `model_visible(visibility, model_ref)`, `node_visible(visibility, node_name)`.
- Later tasks use these functions for setup checks and resolver decisions.

- [ ] **Step 1: Add failing tests for object-info visibility**

Append to `tests/test_modular_install.py`:

```python
from scripts.camera_lab_setup.modules import ModelRef
from scripts.camera_lab_setup.visibility import model_visible, node_visible, visibility_from_object_info


def test_visibility_reads_combo_options_from_object_info():
    visibility = visibility_from_object_info({
        "UNETLoader": {"input": {"required": {"unet_name": ["COMBO", {"options": ["model-a.safetensors"]}]}}},
        "VAELoader": {"input": {"required": {"vae_name": [["vae-a.safetensors"], {}]}}},
        "LTXDirector": {"input": {"required": {}}},
    })

    assert node_visible(visibility, "LTXDirector")
    assert model_visible(visibility, ModelRef("diffusion_models", "model-a.safetensors"))
    assert model_visible(visibility, ModelRef("vae", "vae-a.safetensors"))
    assert not model_visible(visibility, ModelRef("loras", "missing.safetensors"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_visibility_reads_combo_options_from_object_info -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.camera_lab_setup.visibility'`.

- [ ] **Step 3: Implement visibility parsing**

Create `scripts/camera_lab_setup/visibility.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .modules import ModelRef


LOADER_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    "checkpoints": (("CheckpointLoaderSimple", "ckpt_name"),),
    "diffusion_models": (("UNETLoader", "unet_name"), ("UnetLoaderGGUF", "unet_name")),
    "text_encoders": (("DualCLIPLoader", "clip_name1"), ("DualCLIPLoader", "clip_name2"), ("LTXAVTextEncoderLoader", "text_encoder_name"), ("LTXAVTextEncoderLoader", "clip_name")),
    "vae": (("VAELoader", "vae_name"), ("VAELoaderKJ", "vae_name"), ("LTXVAudioVAELoader", "vae_name")),
    "loras": (("LoraLoaderModelOnly", "lora_name"),),
    "latent_upscale_models": (("LatentUpscaleModelLoader", "model_name"),),
}


@dataclass(frozen=True)
class ComfyVisibility:
    nodes: frozenset[str]
    models: Mapping[str, frozenset[str]]
    source: str


def _input_entry_options(entry: Any) -> list[str]:
    if not isinstance(entry, list) or not entry:
        return []
    first = entry[0]
    if isinstance(first, list):
        return [str(item) for item in first]
    if isinstance(first, str) and len(entry) > 1 and isinstance(entry[1], dict):
        options = entry[1].get("options")
        if isinstance(options, list):
            return [str(item) for item in options]
    return []


def visibility_from_object_info(object_info: Mapping[str, Any]) -> ComfyVisibility:
    models: dict[str, set[str]] = {}
    for folder, loaders in LOADER_FIELDS.items():
        names: set[str] = set()
        for node_name, field in loaders:
            node = object_info.get(node_name, {})
            input_info = node.get("input", {}) if isinstance(node, dict) else {}
            entries = {}
            entries.update(input_info.get("required", {}) or {})
            entries.update(input_info.get("optional", {}) or {})
            names.update(_input_entry_options(entries.get(field)))
        if names:
            models[folder] = names
    return ComfyVisibility(
        nodes=frozenset(str(name) for name in object_info.keys()),
        models={folder: frozenset(names) for folder, names in models.items()},
        source="object_info",
    )


def model_visible(visibility: ComfyVisibility, model: ModelRef) -> bool:
    return model.name in visibility.models.get(model.folder, frozenset())


def node_visible(visibility: ComfyVisibility, node_name: str) -> bool:
    return node_name in visibility.nodes
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/visibility.py tests/test_modular_install.py
git commit -m "feat: read setup visibility from object info"
```

---

### Task 4: Module Resolver

**Files:**
- Create: `scripts/camera_lab_setup/resolver.py`
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `CameraLabModule`, `HardwareProfile`, `ComfyVisibility`.
- Produces: `ModuleStatus`, `resolve_module(module, hardware, visibility, enabled=True)`, `resolve_modules(modules, hardware, visibility, enabled_ids=None)`.
- Later tasks expose `ModuleStatus.to_dict()` via setup checks and `/api/config`.

- [ ] **Step 1: Add failing resolver tests**

Append to `tests/test_modular_install.py`:

```python
from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.resolver import resolve_module
from scripts.camera_lab_setup.visibility import ComfyVisibility


def test_resolver_marks_director_ready_when_v2_profile_is_visible():
    director = get_module("director")
    visibility = ComfyVisibility(
        nodes=frozenset({"LTXDirector", "LTXDirectorGuide", "LTXDirectorCropGuides"}),
        models={
            "diffusion_models": frozenset({"ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
            "vae": frozenset({"LTX23_audio_vae_bf16.safetensors", "LTX23_video_vae_bf16.safetensors", "taeltx2_3.safetensors"}),
            "text_encoders": frozenset({"gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2.3_text_projection_bf16.safetensors"}),
        },
        source="test",
    )

    status = resolve_module(director, HardwareProfile(vram_gb=24), visibility)

    assert status.ready is True
    assert status.profile == "director-v2-distilled-fp8"
    assert status.recommendation == "recommended"
    assert status.missing == ()


def test_resolver_reports_risky_when_hardware_is_below_profile():
    camera = get_module("camera")
    visibility = ComfyVisibility(
        nodes=frozenset({"LTXVConditioning"}),
        models={
            "checkpoints": frozenset({"ltx-2.3-22b-dev-fp8.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
            "text_encoders": frozenset({"gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2.3_text_projection_bf16.safetensors"}),
        },
        source="test",
    )

    status = resolve_module(camera, HardwareProfile(vram_gb=8), visibility)

    assert status.ready is True
    assert status.recommendation == "risky"
    assert any("8 GiB VRAM" in warning for warning in status.warnings)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_resolver_marks_director_ready_when_v2_profile_is_visible -q`

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.camera_lab_setup.resolver'`.

- [ ] **Step 3: Implement resolver**

Create `scripts/camera_lab_setup/resolver.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .hardware import HardwareProfile
from .modules import CameraLabModule, ModelProfile
from .visibility import ComfyVisibility, model_visible, node_visible


@dataclass(frozen=True)
class ModuleStatus:
    id: str
    label: str
    enabled: bool
    ready: bool
    profile: str | None
    recommendation: str
    missing: tuple[str, ...]
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "enabled": self.enabled,
            "ready": self.ready,
            "profile": self.profile,
            "recommendation": self.recommendation,
            "missing": list(self.missing),
            "warnings": list(self.warnings),
        }


def _profile_missing(module: CameraLabModule, profile: ModelProfile, visibility: ComfyVisibility) -> tuple[str, ...]:
    missing: list[str] = []
    for node_name in (*module.required_nodes, *profile.required_nodes):
        if not node_visible(visibility, node_name):
            missing.append(node_name)
    for model in profile.required_models:
        if not model_visible(visibility, model):
            missing.append(model.name)
    return tuple(missing)


def _hardware_recommendation(profile: ModelProfile, hardware: HardwareProfile, ready: bool) -> tuple[str, tuple[str, ...]]:
    if not ready:
        return "available-with-downloads", ()
    if hardware.vram_gb is not None and profile.min_vram_gb is not None and hardware.vram_gb < profile.min_vram_gb:
        return "risky", (f"{hardware.vram_gb} GiB VRAM detected; {profile.label} is expected to need at least {profile.min_vram_gb:g} GiB.",)
    return "recommended", ()


def resolve_module(module: CameraLabModule, hardware: HardwareProfile, visibility: ComfyVisibility, enabled: bool = True) -> ModuleStatus:
    if not enabled:
        return ModuleStatus(module.id, module.label, False, False, None, "disabled", (), ())
    if not module.model_profiles:
        missing = tuple(node for node in module.required_nodes if not node_visible(visibility, node))
        return ModuleStatus(module.id, module.label, True, not missing, None, "recommended" if not missing else "unavailable", missing, ())

    candidates: list[tuple[ModelProfile, tuple[str, ...]]] = [
        (profile, _profile_missing(module, profile, visibility)) for profile in module.model_profiles
    ]
    ready_candidates = [(profile, missing) for profile, missing in candidates if not missing]
    if ready_candidates:
        profile, missing = ready_candidates[-1]
    else:
        profile, missing = min(candidates, key=lambda item: len(item[1]))
    ready = not missing
    recommendation, warnings = _hardware_recommendation(profile, hardware, ready)
    if missing and any(item in missing for item in (*module.required_nodes, *profile.required_nodes)):
        recommendation = "unavailable"
    return ModuleStatus(module.id, module.label, True, ready, profile.id, recommendation, missing, warnings)


def resolve_modules(
    modules: Iterable[CameraLabModule],
    hardware: HardwareProfile,
    visibility: ComfyVisibility,
    enabled_ids: set[str] | None = None,
) -> dict[str, ModuleStatus]:
    return {
        module.id: resolve_module(module, hardware, visibility, enabled=(enabled_ids is None or module.id in enabled_ids))
        for module in modules
    }
```

- [ ] **Step 4: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/camera_lab_setup/resolver.py tests/test_modular_install.py
git commit -m "feat: resolve module install recommendations"
```

---

### Task 5: Module-Aware Workflow Installation And CLI Installer

**Files:**
- Create: `scripts/install_camera_lab.py`
- Modify: `scripts/camera_lab_common.py`
- Modify: `scripts/install_workflows.py`
- Modify: `scripts/agent_setup.py`
- Test: `tests/test_modular_install.py`

**Interfaces:**
- Consumes: `selected_modules`.
- Produces: `install_workflows(include_experimental=False, module_ids=None) -> int` remains compatible and installs only selected module workflow files when `module_ids` is passed.
- Produces CLI flags `--list-modules`, `--modules`, `--all`, `--skip-node`, `--install-playwright-browser`, `--skip-workflow-install`.

- [ ] **Step 1: Add failing workflow selection test**

Append to `tests/test_modular_install.py`:

```python
from scripts.camera_lab_common import workflow_sources


def test_workflow_sources_can_filter_by_module():
    sources = workflow_sources(module_ids=["director"])

    assert len(sources) == 1
    assert sources[0][0] == "app"
    assert sources[0][2] == ("ltx_director_reference_mvp.json",)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py::test_workflow_sources_can_filter_by_module -q`

Expected: FAIL with `TypeError: workflow_sources() got an unexpected keyword argument 'module_ids'`.

- [ ] **Step 3: Update common workflow installation**

Modify `scripts/camera_lab_common.py`:

```python
from camera_lab_setup.modules import selected_modules
```

Change `workflow_sources` to:

```python
def workflow_sources(include_experimental: bool = False, module_ids: list[str] | tuple[str, ...] | None = None) -> list[tuple[str, Path, tuple[str, ...] | None]]:
    if module_ids is None:
        sources: list[tuple[str, Path, tuple[str, ...] | None]] = [("app", REPO_ROOT / "workflows" / "app", None)]
    else:
        names: list[str] = []
        for module in selected_modules(module_ids):
            names.extend(module.workflows)
        sources = [("app", REPO_ROOT / "workflows" / "app", tuple(dict.fromkeys(names)))]
    if include_experimental:
        sources.append(("experimental", REPO_ROOT / "workflows" / "experimental", None))
    return sources
```

Change the install loop in `install_workflows`:

```python
def install_workflows(include_experimental: bool = False, module_ids: list[str] | tuple[str, ...] | None = None) -> int:
    ...
    for name, source, allowed_names in workflow_sources(include_experimental, module_ids=module_ids):
        ...
        workflows = sorted(source.glob("*.json"))
        if allowed_names is not None:
            allowed = set(allowed_names)
            workflows = [workflow for workflow in workflows if workflow.name in allowed]
        for workflow in workflows:
            shutil.copy2(workflow, target / workflow.name)
```

- [ ] **Step 4: Update installer scripts**

Modify `scripts/install_workflows.py`:

```python
parser.add_argument("--modules", help="Comma-separated module ids to install, for example camera,director.")
...
module_ids = [item.strip() for item in args.modules.split(",") if item.strip()] if args.modules else None
install_workflows(include_experimental=args.include_experimental, module_ids=module_ids)
```

Modify `scripts/agent_setup.py`:

```python
parser.add_argument("--modules", help="Comma-separated module ids to install workflows for.")
...
module_ids = [item.strip() for item in args.modules.split(",") if item.strip()] if args.modules else None
install_workflows(include_experimental=args.include_experimental_workflows, module_ids=module_ids)
```

Create `scripts/install_camera_lab.py`:

```python
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys

from camera_lab_common import ENV_EXAMPLE_PATH, ENV_PATH, REPO_ROOT, comfy_root_from_env, install_workflows, load_env, python_executable
from camera_lab_setup.hardware import detect_hardware
from camera_lab_setup.modules import MODULES, module_ids


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def parse_modules(raw: str | None, all_modules: bool) -> list[str] | None:
    if all_modules:
        return module_ids()
    if not raw:
        return None
    return [item.strip() for item in raw.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Camera Lab with optional modules.")
    parser.add_argument("--list-modules", action="store_true", help="List installable modules and exit.")
    parser.add_argument("--modules", help="Comma-separated module ids to install.")
    parser.add_argument("--all", action="store_true", help="Install all modules.")
    parser.add_argument("--skip-node", action="store_true", help="Skip npm install.")
    parser.add_argument("--install-playwright-browser", action="store_true", help="Install Playwright Chromium.")
    parser.add_argument("--skip-workflow-install", action="store_true", help="Do not install workflows into ComfyUI.")
    args = parser.parse_args()

    if args.list_modules:
        for module in MODULES:
            print(f"{module.id}: {module.label} - {module.description}")
        return 0

    selected = parse_modules(args.modules, args.all)
    hardware = detect_hardware(repo_root=REPO_ROOT, comfy_root=comfy_root_from_env())
    print(f"Hardware: GPU={hardware.gpu_name or 'unknown'}, VRAM={hardware.vram_gb or 'unknown'} GiB, OS={hardware.os_name}, Python={hardware.python_version}")
    for warning in hardware.warnings:
        print(f"Warning: {warning}", file=sys.stderr)

    if not ENV_PATH.exists():
        if not ENV_EXAMPLE_PATH.exists():
            print(".env.example is missing.", file=sys.stderr)
            return 1
        shutil.copy2(ENV_EXAMPLE_PATH, ENV_PATH)
        print("Created .env from .env.example. Edit COMFYUI_ROOT before running setup checks.")

    print("Installing Python dependencies...")
    run([python_executable(), "-m", "pip", "install", "-r", "requirements.txt"])

    if not args.skip_node and (REPO_ROOT / "package.json").exists():
        npm = shutil.which("npm")
        if npm:
            print("Installing Node dependencies...")
            run([npm, "install"])
            if args.install_playwright_browser:
                npx = shutil.which("npx")
                if npx:
                    run([npx, "playwright", "install", "chromium"])
        else:
            print("npm was not found. Skipping Node dependencies.", file=sys.stderr)

    load_env()
    comfy_root = comfy_root_from_env()
    if not args.skip_workflow_install and comfy_root and comfy_root.exists():
        install_workflows(module_ids=selected)
    elif not args.skip_workflow_install:
        print("COMFYUI_ROOT is not configured or does not exist. Skipping workflow install.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py -q`

Expected: PASS.

- [ ] **Step 6: Smoke CLI list mode**

Run: `python scripts/install_camera_lab.py --list-modules`

Expected: prints `camera`, `director`, `edit`, `casting`, and `motion`.

- [ ] **Step 7: Commit**

```bash
git add scripts/camera_lab_common.py scripts/install_workflows.py scripts/agent_setup.py scripts/install_camera_lab.py tests/test_modular_install.py
git commit -m "feat: add modular installer entry point"
```

---

### Task 6: Module-Aware Setup Checks

**Files:**
- Modify: `scripts/check_setup.py`
- Test: `tests/test_check_setup_modules.py`

**Interfaces:**
- Consumes: `MODULES`, `detect_hardware`, `visibility_from_object_info`, `resolve_modules`.
- Produces CLI options `--modules` and module-aware output.

- [ ] **Step 1: Add failing unit test for model visibility through object info**

Create `tests/test_check_setup_modules.py`:

```python
from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.modules import get_module
from scripts.camera_lab_setup.resolver import resolve_module
from scripts.camera_lab_setup.visibility import visibility_from_object_info


def test_director_check_uses_object_info_model_visibility():
    visibility = visibility_from_object_info({
        "LTXDirector": {"input": {"required": {}}},
        "LTXDirectorGuide": {"input": {"required": {}}},
        "LTXDirectorCropGuides": {"input": {"required": {}}},
        "UNETLoader": {"input": {"required": {"unet_name": ["COMBO", {"options": ["ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"]}]}}},
        "LatentUpscaleModelLoader": {"input": {"required": {"model_name": ["COMBO", {"options": ["ltx-2.3-spatial-upscaler-x2-1.1.safetensors"]}]}}},
        "VAELoader": {"input": {"required": {"vae_name": [["LTX23_audio_vae_bf16.safetensors", "LTX23_video_vae_bf16.safetensors", "taeltx2_3.safetensors"], {}]}}},
        "DualCLIPLoader": {"input": {"required": {"clip_name1": [["gemma_3_12B_it_fp4_mixed.safetensors"], {}], "clip_name2": [["ltx-2.3_text_projection_bf16.safetensors"], {}]}}},
    })

    status = resolve_module(get_module("director"), HardwareProfile(vram_gb=24), visibility)

    assert status.ready is True
    assert status.profile == "director-v2-distilled-fp8"
```

- [ ] **Step 2: Run test to verify it passes under resolver and protects check behavior**

Run: `python -m pytest -p no:cacheprovider tests/test_check_setup_modules.py -q`

Expected before modifying `check_setup.py`: PASS. This pins the shared behavior the script must use.

- [ ] **Step 3: Refactor `check_setup.py` to use shared module status**

Modify imports in `scripts/check_setup.py`:

```python
from camera_lab_setup.hardware import detect_hardware
from camera_lab_setup.modules import MODULES, selected_modules
from camera_lab_setup.resolver import resolve_modules
from camera_lab_setup.visibility import ComfyVisibility, visibility_from_object_info
```

Add parser option:

```python
parser.add_argument("--modules", help="Comma-separated module ids to check.")
args = parser.parse_args()
module_ids = [item.strip() for item in args.modules.split(",") if item.strip()] if args.modules else None
```

After the ComfyUI server check, fetch object info:

```python
visibility = ComfyVisibility(nodes=frozenset(), models={}, source="offline")
try:
    object_info = http_json(f"{comfy_url}/object_info", timeout=30.0)
    visibility = visibility_from_object_info(object_info)
except (urllib.error.URLError, TimeoutError, OSError) as exc:
    print(f"[WARN] ComfyUI object_info unavailable - shared model paths cannot be confirmed: {exc}")
```

Replace the `for model in REQUIRED_MODELS` loop with module status output:

```python
hardware = detect_hardware(repo_root=REPO_ROOT, comfy_root=comfy_root)
print(f"[INFO] Hardware - GPU={hardware.gpu_name or 'unknown'}, VRAM={hardware.vram_gb or 'unknown'} GiB")
statuses = resolve_modules(selected_modules(module_ids), hardware, visibility)
for status in statuses.values():
    add_check(checks, f"Module {status.id}", status.ready, f"profile={status.profile or 'none'} recommendation={status.recommendation}")
    for missing in status.missing:
        add_check(checks, f"Module {status.id} dependency {missing}", False, missing)
    for warning in status.warnings:
        print(f"[WARN] Module {status.id} - {warning}")
```

Keep workflow installed checks, but filter them by selected module workflows when `module_ids` is set.

- [ ] **Step 4: Run setup check against current machine**

Run: `python scripts/check_setup.py --modules director`

Expected: Director module reports ready on this machine when ComfyUI is running and object_info contains the moved/shared models.

- [ ] **Step 5: Run tests**

Run: `python -m pytest -p no:cacheprovider tests/test_modular_install.py tests/test_check_setup_modules.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/check_setup.py tests/test_check_setup_modules.py
git commit -m "feat: make setup checks module aware"
```

---

### Task 7: Backend Config Module Status

**Files:**
- Modify: `server/camera_lab_server.py`
- Test: `tests/test_config_modules.py`

**Interfaces:**
- Consumes: resolver functions.
- Produces config payload field `modules: { [module_id]: ModuleStatus.to_dict() }`.
- Frontend task consumes `state.config.modules`.

- [ ] **Step 1: Add failing config helper test**

Create `tests/test_config_modules.py`:

```python
import server.camera_lab_server as server


def test_public_module_statuses_are_config_serializable(monkeypatch):
    monkeypatch.setattr(server, "object_info", lambda: {
        "LTXDirector": {"input": {"required": {}}},
        "LTXDirectorGuide": {"input": {"required": {}}},
    })

    modules = server.public_modules()

    assert "director" in modules
    assert modules["director"]["id"] == "director"
    assert "enabled" in modules["director"]
    assert "ready" in modules["director"]
    assert "missing" in modules["director"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_config_modules.py -q`

Expected: FAIL with `AttributeError: module 'server.camera_lab_server' has no attribute 'public_modules'`.

- [ ] **Step 3: Implement `public_modules`**

Modify imports in `server/camera_lab_server.py`:

```python
sys.path.insert(0, str(ROOT / "scripts")) if str(ROOT / "scripts") not in sys.path else None
from camera_lab_setup.hardware import detect_hardware
from camera_lab_setup.modules import MODULES
from camera_lab_setup.resolver import resolve_modules
from camera_lab_setup.visibility import ComfyVisibility, visibility_from_object_info
```

Add near `public_workflows`:

```python
def public_modules() -> dict[str, dict[str, Any]]:
    try:
        visibility = visibility_from_object_info(object_info())
    except Exception:
        visibility = ComfyVisibility(nodes=frozenset(), models={}, source="offline")
    hardware = detect_hardware(repo_root=ROOT, comfy_root=COMFY_ROOT)
    statuses = resolve_modules(MODULES, hardware, visibility)
    return {module_id: status.to_dict() for module_id, status in statuses.items()}
```

Update `/api/config` response:

```python
"modules": public_modules(),
```

- [ ] **Step 4: Run test**

Run: `python -m pytest -p no:cacheprovider tests/test_config_modules.py -q`

Expected: PASS.

- [ ] **Step 5: Run targeted server tests**

Run: `python -m pytest -p no:cacheprovider tests/test_motion_endpoint.py::test_public_workflows_can_skip_status_checks tests/test_config_modules.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/camera_lab_server.py tests/test_config_modules.py
git commit -m "feat: expose module readiness in config"
```

---

### Task 8: Frontend Disabled Tabs

**Files:**
- Modify: `frontend/app.js`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Consumes: `state.config.modules`.
- Produces: disabled/greyed workspace tab behavior and hash redirect.

- [ ] **Step 1: Add failing Playwright test**

Append to `tests/e2e/home.spec.js`:

```javascript
test("unready modules disable workspace tabs and direct hashes fall back to camera", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    const config = {
      workflows: [{ id: "i2v_mock", label: "Mock I2V", mode: "i2v", available: true }],
      camera_moves: [{ id: "push_in", name: "Push in", prompts: { base: "A calm camera push in." } }],
      camera_examples: {},
      default_negative: "",
      comfy: { ok: true, reason: "", url: "http://127.0.0.1:8188" },
      casting: { voices: [] },
      modules: {
        camera: { enabled: true, ready: true, missing: [] },
        director: { enabled: true, ready: false, missing: ["LTXDirector"] },
        edit: { enabled: false, ready: false, missing: [] },
        casting: { enabled: true, ready: true, missing: [] },
        motion: { enabled: true, ready: true, missing: [] },
      },
    };
    await route.fulfill({ json: config });
  });
  await page.goto("/#director");

  await expect(page.locator("#directorWorkspaceTab")).toBeVisible();
  await expect(page.locator("#directorWorkspaceTab")).toBeDisabled();
  await expect(page.locator("#editWorkspaceTab")).toBeVisible();
  await expect(page.locator("#editWorkspaceTab")).toBeDisabled();
  await expect(page.locator("#cameraWorkspaceTab")).toHaveClass(/active/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/home.spec.js --grep "unready modules disable" --reporter=line`

Expected: FAIL because `#directorWorkspaceTab` is still enabled or hash activates Director.

- [ ] **Step 3: Add frontend module helpers**

Modify `frontend/app.js` near workspace helpers:

```javascript
const workspaceModules = {
  camera: "camera",
  director: "director",
  edit: "edit",
  casting: "casting",
  motion: "motion",
};

function moduleReady(moduleId) {
  const module = state.config?.modules?.[moduleId];
  if (!module) return true;
  return module.enabled !== false && module.ready !== false;
}

function workspaceReady(workspace) {
  const moduleId = workspaceModules[workspace];
  return !moduleId || moduleReady(moduleId);
}

function firstReadyWorkspace() {
  return ["camera", "director", "edit", "casting", "motion"].find(workspaceReady) || "camera";
}

function moduleUnavailableReason(moduleId) {
  const module = state.config?.modules?.[moduleId];
  if (!module) return "";
  if (Array.isArray(module.missing) && module.missing.length) return module.missing.join(", ");
  return module.ready === false || module.enabled === false ? "Module unavailable" : "";
}

function applyModuleAvailability() {
  for (const [workspace, moduleId] of Object.entries(workspaceModules)) {
    const tab = $(`${workspace}WorkspaceTab`);
    if (!tab) continue;
    const ready = moduleReady(moduleId);
    tab.disabled = !ready;
    tab.classList.toggle("module-unavailable", !ready);
    tab.title = ready ? "" : moduleUnavailableReason(moduleId);
  }
}
```

At the start of `setWorkspace`:

```javascript
if (!workspaceReady(workspace)) {
  workspace = firstReadyWorkspace();
  syncWorkflow = false;
}
```

In `loadConfig`, after `state.config = await api("/api/config");`:

```javascript
applyModuleAvailability();
if (!workspaceReady(state.workspace)) state.workspace = firstReadyWorkspace();
```

When initial hash is processed, ensure unavailable workspaces fall back:

```javascript
const requestedWorkspace = hashToWorkspace(location.hash);
setWorkspace(workspaceReady(requestedWorkspace) ? requestedWorkspace : firstReadyWorkspace(), { syncWorkflow: false });
```

If the code does not have `hashToWorkspace`, implement it by adapting the existing hash checks in `loadConfig`.

- [ ] **Step 4: Run Playwright test**

Run: `npx playwright test tests/e2e/home.spec.js --grep "unready modules disable" --reporter=line`

Expected: PASS.

- [ ] **Step 5: Run broader frontend smoke tests**

Run: `npx playwright test tests/e2e/home.spec.js --reporter=line`

Expected: PASS or only known pre-existing failures unrelated to module availability. If failures are due to tests expecting all tabs enabled, update those tests to provide ready modules in their mocked config.

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js tests/e2e/home.spec.js
git commit -m "feat: grey unavailable workspace modules"
```

---

### Task 9: Documentation And Compatibility Polish

**Files:**
- Modify: `README.md`
- Modify: `scripts/check_setup.ps1`
- Modify: `scripts/install_workflows.ps1`
- Test: manual command checks.

**Interfaces:**
- Keeps PowerShell wrappers working.
- Documents the new recommended entry point.

- [ ] **Step 1: Update README quick start**

Modify `README.md` Quick Start to lead with:

```powershell
python scripts/install_camera_lab.py --all
python scripts/check_setup.py
```

Add examples:

```powershell
python scripts/install_camera_lab.py --list-modules
python scripts/install_camera_lab.py --modules camera,director
python scripts/check_setup.py --modules director
```

Keep the old `agent_setup.py` commands under an "Agent compatibility" paragraph.

- [ ] **Step 2: Update PowerShell workflow wrapper**

Modify `scripts/install_workflows.ps1` params:

```powershell
param(
    [switch]$IncludeExperimental,
    [string]$Modules
)
```

Forward module filtering:

```powershell
$pythonArgs = @("scripts/install_workflows.py")
if ($IncludeExperimental) { $pythonArgs += "--include-experimental" }
if ($Modules) { $pythonArgs += @("--modules", $Modules) }
python @pythonArgs
exit $LASTEXITCODE
```

Replace the duplicated install body with the Python delegation above.

- [ ] **Step 3: Update PowerShell setup check wrapper**

Replace `scripts/check_setup.ps1` body with:

```powershell
[CmdletBinding()]
param(
    [string]$Modules
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$pythonArgs = @("scripts/check_setup.py")
if ($Modules) { $pythonArgs += @("--modules", $Modules) }
python @pythonArgs
exit $LASTEXITCODE
```

- [ ] **Step 4: Run compatibility commands**

Run:

```powershell
python scripts/install_camera_lab.py --list-modules
python scripts/install_workflows.py --modules director
python scripts/check_setup.py --modules director
.\scripts\install_workflows.ps1 -Modules director
.\scripts\check_setup.ps1 -Modules director
```

Expected: commands complete; `check_setup` reports module status instead of raw missing paths when ComfyUI is online.

- [ ] **Step 5: Commit**

```bash
git add README.md scripts/check_setup.ps1 scripts/install_workflows.ps1
git commit -m "docs: document modular installer"
```

---

## Final Verification

- [ ] Run Python unit tests:

```powershell
python -m pytest -p no:cacheprovider tests/test_modular_install.py tests/test_check_setup_modules.py tests/test_config_modules.py tests/test_motion_endpoint.py tests/test_director_reference.py
```

- [ ] Run setup command smoke tests:

```powershell
python scripts/install_camera_lab.py --list-modules
python scripts/check_setup.py --modules director
```

- [ ] Run frontend smoke test affected by module availability:

```powershell
npx playwright test tests/e2e/home.spec.js --grep "unready modules disable" --reporter=line
```

- [ ] Check git status:

```powershell
git status --short
```

Expected: only intentional files changed; no `.env`, `tasks/`, generated media, or model files staged.

## Self-Review Notes

- Spec coverage: module registry, hardware profile, model profiles, installer, setup checks, frontend capability contract, migration, and testing are each mapped to tasks.
- Placeholder scan: no task uses placeholder language; each code task includes concrete test and implementation snippets.
- Type consistency: `HardwareProfile`, `ModelRef`, `ModelProfile`, `CameraLabModule`, `ComfyVisibility`, and `ModuleStatus` are introduced before use by later tasks.
