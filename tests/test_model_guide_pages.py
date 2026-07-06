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
