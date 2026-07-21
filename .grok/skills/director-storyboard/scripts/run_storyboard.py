#!/usr/bin/env python3
"""Thin wrapper: skill-local entrypoint for the repo runner."""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

# .../camera-lab/.grok/skills/director-storyboard/scripts/this_file.py
# parents[4] == repo root
REPO_ROOT = Path(__file__).resolve().parents[4]
REPO_RUNNER = REPO_ROOT / "scripts" / "run_director_storyboard.py"

if not REPO_RUNNER.exists():
    raise SystemExit(f"runner not found: {REPO_RUNNER}")

sys.argv[0] = str(REPO_RUNNER)
runpy.run_path(str(REPO_RUNNER), run_name="__main__")
