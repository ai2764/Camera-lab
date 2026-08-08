from __future__ import annotations

import os
import sys
from pathlib import Path


def app_root(anchor_file: Path) -> Path:
    override = os.environ.get("CAMERA_LAB_APP_ROOT", "").strip()
    if override:
        return Path(override).expanduser()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(anchor_file).resolve().parents[1]
