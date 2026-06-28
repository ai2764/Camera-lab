import subprocess
import sys
from pathlib import Path

import pytest

from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.modules import ModelProfile, get_module, selected_modules
from scripts.camera_lab_setup.resolver import resolve_module
from scripts.camera_lab_setup.visibility import ComfyVisibility


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def visible_models_for_profiles(profile_ids: set[str]) -> ComfyVisibility:
    models: dict[str, set[str]] = {}
    for module in selected_modules():
        for profile in module.model_profiles:
            if profile.id not in profile_ids:
                continue
            for model in profile.required_models:
                models.setdefault(model.folder, set()).add(model.name)
    return ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "LTXDirector", "LTXDirectorGuide", "LTXDirectorCropGuides", "HYMotionGenerate"}),
        models={folder: frozenset(names) for folder, names in models.items()},
        source="test",
    )


def test_installer_can_list_profile_compatibility():
    result = subprocess.run(
        [sys.executable, "scripts/install_camera_lab.py", "--list-profiles", "--modules", "camera,director"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )

    assert "camera-ltx23-gguf-q4" in result.stdout
    assert "workflow_variant" in result.stdout
    assert "director-v2-distilled-fp8" in result.stdout
    assert "drop_in" in result.stdout


def test_storage_plan_counts_drop_in_profiles_only():
    from scripts.install_camera_lab import build_storage_plan

    plan = build_storage_plan(selected_modules(["camera", "director"]))

    assert [profile.id for profile in plan.profiles] == ["camera-ltx23-fp8", "director-v1-ltx23-fp8"]
    assert plan.required_gb == 81
    assert all(profile.compatibility == "drop_in" for profile in plan.profiles)


def test_storage_plan_ignores_profiles_whose_models_already_exist(tmp_path):
    from scripts.install_camera_lab import build_storage_plan

    models_root = tmp_path / "models"
    profile = get_module("director").model_profiles[0]
    for model in profile.required_models:
        target = models_root / model.folder / model.name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("model", encoding="utf-8")

    plan = build_storage_plan(selected_modules(["director"]), models_root=models_root)

    assert plan.profiles == ()
    assert plan.required_gb == 0


def test_storage_plan_ignores_profiles_visible_to_comfy_object_info():
    from scripts.install_camera_lab import build_storage_plan

    visibility = ComfyVisibility(
        nodes=frozenset(),
        models={
            "checkpoints": frozenset({"ltx-2.3-22b-dev-fp8.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
            "vae": frozenset({"LTX23_audio_vae_bf16.safetensors", "LTX23_video_vae_bf16.safetensors", "taeltx2_3.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "text_encoders": frozenset({"gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2.3_text_projection_bf16.safetensors"}),
        },
        source="test",
    )

    plan = build_storage_plan(selected_modules(["director"]), visibility=visibility)

    assert plan.profiles == ()
    assert plan.required_gb == 0


def test_storage_plan_does_not_count_profiles_without_comfy_model_refs():
    from scripts.install_camera_lab import build_storage_plan

    plan = build_storage_plan(selected_modules(["casting"]))

    assert plan.profiles == ()
    assert plan.required_gb == 0


def test_storage_plan_reports_low_space_with_headroom():
    from scripts.install_camera_lab import check_storage

    plan = check_storage(
        selected_modules(["director"]),
        HardwareProfile(comfy_free_gb=50),
        headroom_gb=20,
    )

    assert plan.available_gb == 50
    assert plan.required_gb == 42
    assert plan.required_with_headroom_gb == 62
    assert plan.ok is False


def test_missing_downloadable_models_use_registered_urls(tmp_path):
    from scripts.install_camera_lab import missing_downloadable_models

    profile = ModelProfile(
        id="test-profile",
        label="Test profile",
        required_models=(
            get_module("edit").model_profiles[1].required_models[0],
        ),
    )
    models_root = tmp_path / "models"

    missing = missing_downloadable_models([profile], models_root)

    assert len(missing.downloadable) == 1
    assert missing.downloadable[0].model.name == "wan2.1_vace_14B_fp16.safetensors"
    assert missing.downloadable[0].url.startswith("https://")


def test_missing_downloadable_models_skip_visible_models(tmp_path):
    from scripts.install_camera_lab import missing_downloadable_models

    profile = get_module("edit").model_profiles[1]
    visibility = ComfyVisibility(
        nodes=frozenset(),
        models={
            model.folder: frozenset({model.name})
            for model in profile.required_models
        },
        source="test",
    )

    missing = missing_downloadable_models([profile], tmp_path / "models", visibility=visibility)

    assert missing.downloadable == ()
    assert missing.manual == ()


@pytest.mark.parametrize(
    "case",
    [
        {
            "name": "rtx4090_all_modules_models_already_visible",
            "modules": None,
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 4090", vram_gb=24, comfy_free_gb=74),
            "visibility": visible_models_for_profiles(
                {
                    "camera-ltx23-fp8",
                    "director-v1-ltx23-fp8",
                    "edit-bernini-fp8",
                    "edit-vace14-fp16",
                    "motion-scail2-wan14-fp8",
                }
            ),
            "expected_required_gb": 0,
            "expected_storage_ok": True,
            "expected_profiles": [],
        },
        {
            "name": "rtx4090_camera_missing_models_enough_disk",
            "modules": ["camera"],
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 4090", vram_gb=24, comfy_free_gb=80),
            "visibility": ComfyVisibility(nodes=frozenset(), models={}, source="offline"),
            "expected_required_gb": 39,
            "expected_storage_ok": True,
            "expected_profiles": ["camera-ltx23-fp8"],
        },
        {
            "name": "rtx4090_camera_missing_models_low_disk",
            "modules": ["camera"],
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 4090", vram_gb=24, comfy_free_gb=50),
            "visibility": ComfyVisibility(nodes=frozenset(), models={}, source="offline"),
            "expected_required_gb": 39,
            "expected_storage_ok": False,
            "expected_profiles": ["camera-ltx23-fp8"],
        },
        {
            "name": "no_comfy_root_uses_repo_drive_for_preflight",
            "modules": ["camera"],
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 3080", vram_gb=10, repo_free_gb=100),
            "visibility": ComfyVisibility(nodes=frozenset(), models={}, source="offline"),
            "expected_required_gb": 39,
            "expected_storage_ok": True,
            "expected_profiles": ["camera-ltx23-fp8"],
            "expected_target": "repo drive",
        },
    ],
    ids=lambda case: case["name"],
)
def test_installer_storage_reaction_for_machine_profiles(case):
    from scripts.install_camera_lab import check_storage

    plan = check_storage(selected_modules(case["modules"]), case["hardware"], visibility=case["visibility"])

    assert plan.required_gb == case["expected_required_gb"]
    assert plan.ok is case["expected_storage_ok"]
    assert [profile.id for profile in plan.profiles] == case["expected_profiles"]
    if "expected_target" in case:
        assert plan.target_label == case["expected_target"]


@pytest.mark.parametrize(
    "case",
    [
        {
            "name": "rtx4090_director_ready_recommended",
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 4090", vram_gb=24),
            "visibility": visible_models_for_profiles({"director-v1-ltx23-fp8"}),
            "expected_ready": True,
            "expected_recommendation": "recommended",
            "expected_warning_text": None,
        },
        {
            "name": "rtx3060_8gb_director_ready_but_risky",
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 3060", vram_gb=8),
            "visibility": visible_models_for_profiles({"director-v1-ltx23-fp8"}),
            "expected_ready": True,
            "expected_recommendation": "risky",
            "expected_warning_text": "8 GiB VRAM",
        },
        {
            "name": "rtx4090_director_v2_only_not_current_workflow_ready",
            "hardware": HardwareProfile(gpu_name="NVIDIA GeForce RTX 4090", vram_gb=24),
            "visibility": visible_models_for_profiles({"director-v2-distilled-fp8"}),
            "expected_ready": False,
            "expected_recommendation": "available-with-downloads",
            "expected_warning_text": "director-v2-distilled-fp8",
        },
    ],
    ids=lambda case: case["name"],
)
def test_installer_module_reaction_for_gpu_profiles(case):
    status = resolve_module(get_module("director"), case["hardware"], case["visibility"])

    assert status.ready is case["expected_ready"]
    assert status.recommendation == case["expected_recommendation"]
    if case["expected_warning_text"]:
        assert any(case["expected_warning_text"] in warning for warning in status.warnings)
