from __future__ import annotations

import sys
from pathlib import Path

import pytest


def test_app_root_uses_executable_parent_when_frozen(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from scripts.camera_lab_runtime import app_root

    exe = tmp_path / "CameraLab" / "CameraLab.exe"
    exe.parent.mkdir()
    exe.write_text("", encoding="utf-8")

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe))

    assert app_root(Path(__file__)) == exe.parent


def test_app_root_allows_explicit_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from scripts.camera_lab_runtime import app_root

    override = tmp_path / "portable-root"
    monkeypatch.setenv("CAMERA_LAB_APP_ROOT", str(override))

    assert app_root(Path(__file__)) == override


def test_app_root_falls_back_to_source_parent(tmp_path: Path) -> None:
    from scripts.camera_lab_runtime import app_root

    source_file = tmp_path / "repo" / "server" / "camera_lab_server.py"

    assert app_root(source_file) == tmp_path / "repo"
