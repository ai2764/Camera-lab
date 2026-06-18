import server.camera_lab_server as s

LOCAL = s.LOCAL_LTX23_DISTILLED_LORA


def fake_oi():
    return {
        "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["ckpt_a.safetensors"], {}]}}},
        "LoraLoaderModelOnly": {"input": {"required": {"lora_name": [["ltxv/foo.safetensors", LOCAL], {}]}}},
        # empty list -> folder treated as "unknown", never a false missing
        "LatentUpscaleModelLoader": {"input": {"required": {"model_name": [[], {}]}}},
    }


def test_available_models_builds_map_and_omits_empty(monkeypatch):
    monkeypatch.setattr(s, "object_info", fake_oi)
    avail = s.available_models()
    assert avail["checkpoints"] == {"ckpt_a.safetensors"}
    assert LOCAL in avail["loras"]
    assert "latent_upscale_models" not in avail  # empty list omitted
    assert "vae" not in avail  # node absent -> omitted


def test_model_listed_strict(monkeypatch):
    monkeypatch.setattr(s, "object_info", fake_oi)
    assert s.model_listed("loras", LOCAL) is True
    assert s.model_listed("loras", "missing.safetensors") is False
    assert s.model_listed("vae", "anything") is False  # unknown folder -> not listed


def test_model_missing_only_when_confident(monkeypatch):
    monkeypatch.setattr(s, "object_info", fake_oi)
    assert s.model_missing("checkpoints", "ckpt_a.safetensors") is False
    assert s.model_missing("checkpoints", "nope.safetensors") is True  # known+non-empty, absent
    assert s.model_missing("latent_upscale_models", "x") is False  # empty -> unknown, never block
    assert s.model_missing("vae", "x") is False  # node absent -> unknown, never block


def test_ensure_model_exists_never_raises(monkeypatch):
    monkeypatch.setattr(s, "object_info", fake_oi)
    s.ensure_model_exists("checkpoints", "nope.safetensors")  # confidently missing -> warn, no raise
    s.ensure_model_exists("checkpoints", "ckpt_a.safetensors")  # present -> no raise


def test_ensure_model_exists_soft_when_objectinfo_down(monkeypatch):
    def boom():
        raise RuntimeError("ComfyUI unreachable")
    monkeypatch.setattr(s, "object_info", boom)
    s.ensure_model_exists("checkpoints", "whatever")  # avail empty -> not missing -> no raise


def test_patch_ltx23_local_loras_swaps_only_when_listed(monkeypatch):
    monkeypatch.setattr(s, "object_info", fake_oi)
    api = {"1": {"class_type": "LoraLoaderModelOnly",
                 "inputs": {"lora_name": "ltx-2.3-22b-distilled-lora-foo.safetensors"}}}
    s.patch_ltx23_local_loras(api)
    assert api["1"]["inputs"]["lora_name"] == LOCAL  # LOCAL is listed -> swap applied


def test_patch_ltx23_local_loras_skips_when_not_listed(monkeypatch):
    monkeypatch.setattr(s, "object_info", lambda: {"LoraLoaderModelOnly": {"input": {"required": {"lora_name": [["other.safetensors"], {}]}}}})
    api = {"1": {"class_type": "LoraLoaderModelOnly",
                 "inputs": {"lora_name": "ltx-2.3-22b-distilled-lora-foo.safetensors"}}}
    s.patch_ltx23_local_loras(api)
    assert api["1"]["inputs"]["lora_name"] == "ltx-2.3-22b-distilled-lora-foo.safetensors"  # unchanged
