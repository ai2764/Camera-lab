import subprocess
import sys
from pathlib import Path

from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.modules import ModelProfile, get_module, selected_modules
from scripts.camera_lab_setup.visibility import ComfyVisibility


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


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
