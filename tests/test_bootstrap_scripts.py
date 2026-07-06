import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_windows_bootstrap_installs_python_before_running_installer():
    script = ROOT / "setup_windows_python.ps1"

    text = script.read_text(encoding="utf-8")

    assert "Python.Python.3.12" in text
    assert "winget install" in text
    assert "scripts/install_camera_lab.py" in text
    assert "--all" in text
    assert "--list-profiles" in text
    assert "--skip-model-download" in text
    assert "--yes" in text
    assert "$python = @(Resolve-CameraLabPython)" in text


def test_batch_bootstrap_delegates_to_powershell_entrypoint():
    script = ROOT / "setup_windows_python.bat"

    text = script.read_text(encoding="utf-8")

    assert "setup_windows_python.ps1" in text
    assert "ExecutionPolicy Bypass" in text


def test_legacy_windows_bootstrap_delegates_to_renamed_entrypoint():
    script = ROOT / "install_camera_lab.ps1"

    text = script.read_text(encoding="utf-8")

    assert "setup_windows_python.ps1" in text
    assert "renamed" in text
    assert "@PSBoundParameters" in text
    assert "ListProfiles" in text


def test_legacy_batch_bootstrap_delegates_to_renamed_entrypoint():
    script = ROOT / "install_camera_lab.bat"

    text = script.read_text(encoding="utf-8")

    assert "install_camera_lab.ps1" in text
    assert "ExecutionPolicy Bypass" in text


def test_legacy_powershell_bootstrap_preserves_named_switches():
    if not shutil.which("powershell"):
        pytest.skip("PowerShell is not available")

    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT / "install_camera_lab.ps1"),
            "-ListProfiles",
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr
    assert "Model profiles:" in result.stdout


def test_readme_mentions_python_free_windows_bootstrap():
    text = (ROOT / "README.md").read_text(encoding="utf-8")

    assert ".\\setup_windows_python.ps1" in text
    assert "If Python is not installed" in text
