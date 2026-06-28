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
