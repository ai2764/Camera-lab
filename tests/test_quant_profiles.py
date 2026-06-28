import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from camera_lab_setup.modules import _hf, get_module, MODULES

GGUF_LOADER_CLASSES = {"UnetLoaderGGUF", "DualCLIPLoaderGGUF", "CLIPLoaderGGUF"}


def _registry_model_names(module_id, prefix):
    module = get_module(module_id)
    names = set()
    for profile in module.model_profiles:
        if profile.id.startswith(prefix):
            for m in profile.required_models:
                names.add(Path(m.name).name)
    return names


def test_hf_builds_resolve_url():
    assert _hf("QuantStack/LTX-2.3-GGUF", "LTX-2.3-distilled/LTX-2.3-distilled-Q2_K.gguf") == (
        "https://huggingface.co/QuantStack/LTX-2.3-GGUF/resolve/main/"
        "LTX-2.3-distilled/LTX-2.3-distilled-Q2_K.gguf"
    )


def test_ltx_gguf_workflow_only_uses_registered_models_and_gguf_loaders():
    wf_path = ROOT / "workflows" / "app" / "ltx23_gguf_ia2v_nag_extend.json"
    data = json.loads(wf_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", data)  # support either UI graph or api dict
    registered = _registry_model_names("camera", "camera-ltx23-gguf")
    # Every node that loads a diffusion/text model must be a GGUF loader class.
    blob = json.dumps(data)
    assert "UNETLoader" not in blob and "DualCLIPLoader\"" not in blob  # no FP8 loaders left
    assert "UnetLoaderGGUF" in blob
    # Every .gguf filename referenced must be a registered model.
    referenced = set(re.findall(r"[\w./-]+\.gguf", blob))
    referenced = {Path(r).name for r in referenced}
    assert referenced
    assert referenced <= registered, f"unregistered gguf files: {referenced - registered}"


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
