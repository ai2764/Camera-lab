from scripts.camera_lab_setup.modules import MODULES, get_module, module_ids, selected_modules


def test_module_registry_contains_user_facing_workspaces():
    assert module_ids() == ["camera", "director", "edit", "casting", "motion"]
    assert get_module("director").label == "Director"
    assert get_module("director").frontend_workspace == "director"
    assert len(MODULES) == 5


def test_director_profiles_include_v1_and_v2_models():
    director = get_module("director")
    profile_ids = {profile.id for profile in director.model_profiles}
    assert {"director-v1-ltx23-fp8", "director-v2-distilled-fp8"} <= profile_ids
    v2 = next(profile for profile in director.model_profiles if profile.id == "director-v2-distilled-fp8")
    assert any(
        model.folder == "diffusion_models"
        and model.name == "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"
        for model in v2.required_models
    )


def test_selected_modules_preserves_registry_order_and_rejects_unknown_ids():
    assert [module.id for module in selected_modules(["motion", "camera"])] == ["camera", "motion"]
    try:
        selected_modules(["camera", "unknown"])
    except ValueError as exc:
        assert "unknown module: unknown" in str(exc)
    else:
        raise AssertionError("unknown module id should fail")
