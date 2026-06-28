import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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
