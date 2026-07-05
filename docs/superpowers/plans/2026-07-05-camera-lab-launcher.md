# Camera Lab Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host-native interactive CLI (`scripts/launch.py`) that detects the real hardware, prints per-module feasibility + model recommendations, asks whether the user has ComfyUI and wants Docker, then launches one of four deployment modes.

**Architecture:** `scripts/launch.py` runs natively on the host (real GPU visible). It reuses `detect_hardware`, `resolve_modules`, and `visibility_from_object_info` for the assessment, then shells out to `docker compose` / `scripts/start_camera_lab.py` for the chosen mode. One new compose file (`docker-compose.comfy-only.yml`) supplies the only missing deployment (comfy in a container + native camera-lab).

**Tech Stack:** Python 3.12 stdlib (argparse, subprocess, urllib) + the existing `scripts/camera_lab_setup` package; pytest; Docker Compose.

## Global Constraints

- Launcher is a standalone CLI at `scripts/launch.py`; it reuses installer machinery and never duplicates hardware/resolver logic.
- Model handling is **recommend-only** — the launcher never downloads models.
- Four modes exactly: `no-docker`, `full-docker`, `comfy-only-docker`, `cam-lab-only-docker`.
- Non-interactive flags: `--mode <id>` (skip prompts + launch that mode) and `--assess-only` (print assessment, exit 0, launch nothing). There is **no** `--yes` flag.
- Pure helpers (`recommended_mode`, `feasibility_for`, `mode_command`) must be import-safe and I/O-free so they unit-test without a host or Docker.
- Reused interfaces (verbatim):
  - `detect_hardware(repo_root: Path, comfy_root: Path) -> HardwareProfile` with fields `.gpu_name: str|None`, `.vram_gb: int|None`, `.os_name: str`, `.warnings: tuple[str,...]`.
  - `resolve_modules(modules, hardware, visibility, enabled_ids=None) -> dict[str, ModuleStatus]`; `ModuleStatus` has `.ready: bool`, `.profile: str|None`, `.recommendation: str`, `.missing: tuple[str,...]`.
  - `visibility_from_object_info(object_info: Mapping) -> ComfyVisibility`.
  - `MODULES` (list) and each module's `.model_profiles` (each `ModelProfile` has `.id`, `.min_vram_gb: float|None`, `.recommended_vram_gb: float|None`).

---

## File Structure

- `docker-compose.comfy-only.yml` — **create**: single `comfyui` service (same build as full stack), publishes 8188 to host, bind-mounts a host data dir for input/output + host models. No camera-lab service.
- `docker/compose.comfy-only.env.example` — **create**: `MODELS_DIR`, `COMFY_DATA_DIR`, `COMFY_PORT`.
- `scripts/launch.py` — **create**: the CLI. Pure helpers + `probe_comfy` + `assess` + `print_assessment` + `choose_mode` + `launch` + `main`.
- `tests/test_launch.py` — **create**: unit tests for the pure helpers, `feasibility_for`, `assess` (with fakes), and `mode_command`.
- `docker/README.md` — **modify**: add a "Launcher" section documenting `python scripts/launch.py` and the 4 modes.

---

### Task 1: The comfy-only compose file

**Files:**
- Create: `docker-compose.comfy-only.yml`
- Create: `docker/compose.comfy-only.env.example`

**Interfaces:**
- Consumes: `docker/comfyui.Dockerfile` (existing).
- Produces: a compose file that `docker compose config` parses; a `comfyui` service on published port `${COMFY_PORT:-8188}` with `MODELS_DIR` (ro) + a host `COMFY_DATA_DIR` bind-mounted at `/opt/ComfyUI/input` and `/opt/ComfyUI/output`.

- [ ] **Step 1: Write the env example**

Create `docker/compose.comfy-only.env.example`:

```text
# comfy-only mode: ComfyUI in a container, camera-lab runs natively on the host.
# Absolute host path to your ComfyUI models directory (bind-mounted read-only):
MODELS_DIR=/absolute/path/to/ComfyUI/models
# Host dir the container uses for ComfyUI input/output. Native camera-lab must set
# COMFYUI_ROOT to this SAME dir so its staged input lands where the container reads.
COMFY_DATA_DIR=./comfy-data
# Host port the containerized ComfyUI is published on:
COMFY_PORT=8188
```

- [ ] **Step 2: Write the compose file**

Create `docker-compose.comfy-only.yml`:

```yaml
# ComfyUI in a container (GPU), camera-lab runs natively on the host and connects
# to http://127.0.0.1:${COMFY_PORT}. Start it, then run scripts/start_camera_lab.py
# with COMFYUI_ROOT pointed at COMFY_DATA_DIR.
services:
  comfyui:
    build:
      context: .
      dockerfile: docker/comfyui.Dockerfile
    volumes:
      - ${MODELS_DIR:?set MODELS_DIR in docker/compose.comfy-only.env}:/opt/ComfyUI/models:ro
      - ${COMFY_DATA_DIR:?set COMFY_DATA_DIR}/input:/opt/ComfyUI/input
      - ${COMFY_DATA_DIR:?set COMFY_DATA_DIR}/output:/opt/ComfyUI/output
    ports:
      - "${COMFY_PORT:-8188}:8188"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: ["gpu"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8188/object_info', timeout=5); sys.exit(0)"]
      interval: 15s
      timeout: 10s
      retries: 20
      start_period: 120s
```

- [ ] **Step 3: Validate it parses**

Run: `MODELS_DIR=/tmp/m COMFY_DATA_DIR=/tmp/d docker compose -f docker-compose.comfy-only.yml config -q && echo COMPOSE_OK`
Expected: `COMPOSE_OK`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.comfy-only.yml docker/compose.comfy-only.env.example
git commit -m "feat: comfy-only docker compose (comfyui container + native camera-lab)"
```

---

### Task 2: Pure decision helpers

**Files:**
- Create: `scripts/launch.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `MODES = ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker")`.
  - `recommended_mode(has_comfy: bool, want_docker: bool) -> str`.
  - `feasibility_for(min_vram_gb: float | None, recommended_vram_gb: float | None, vram_gb: int | None) -> str` — returns one of `"vram-unknown"`, `"fits"`, `"tight"`, `"insufficient"`, `"any"`.
  - `mode_command(mode: str) -> list[list[str]]` — the ordered command(s) (argv lists) to launch a mode; raises `ValueError` for an unknown mode.

- [ ] **Step 1: Write the failing test**

Create `tests/test_launch.py`:

```python
import pytest

from scripts.launch import MODES, feasibility_for, mode_command, recommended_mode


def test_recommended_mode_matrix():
    assert recommended_mode(has_comfy=True, want_docker=False) == "no-docker"
    assert recommended_mode(has_comfy=True, want_docker=True) == "cam-lab-only-docker"
    assert recommended_mode(has_comfy=False, want_docker=True) == "full-docker"
    # no comfy and no docker: nothing to launch -> sentinel
    assert recommended_mode(has_comfy=False, want_docker=False) == "none"


def test_feasibility_for():
    assert feasibility_for(None, None, 24) == "any"
    assert feasibility_for(16, 24, None) == "vram-unknown"
    assert feasibility_for(16, 24, 24) == "fits"          # >= recommended
    assert feasibility_for(16, 24, 18) == "tight"         # >= min, < recommended
    assert feasibility_for(16, 24, 12) == "insufficient"  # < min
    assert feasibility_for(16, None, 20) == "fits"        # >= min, no recommended
    assert feasibility_for(16, None, 12) == "insufficient"


def test_mode_command_maps_each_mode():
    assert mode_command("no-docker") == [["python", "scripts/start_camera_lab.py", "--open"]]
    assert mode_command("full-docker") == [
        ["docker", "compose", "-f", "docker-compose.yml", "--env-file", "docker/compose.env", "up", "-d", "--build"]
    ]
    assert mode_command("cam-lab-only-docker") == [
        ["docker", "compose", "-f", "docker-compose.camera-lab-only.yml", "--env-file", "docker/compose.camera-lab-only.env", "up", "-d", "--build"]
    ]
    cmds = mode_command("comfy-only-docker")
    assert cmds[0] == ["docker", "compose", "-f", "docker-compose.comfy-only.yml", "--env-file", "docker/compose.comfy-only.env", "up", "-d", "--build"]
    assert cmds[1] == ["python", "scripts/start_camera_lab.py", "--open"]
    assert all(m in MODES for m in ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker"))
    with pytest.raises(ValueError):
        mode_command("bogus")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.launch'`.

- [ ] **Step 3: Implement the helpers**

Create `scripts/launch.py`:

```python
"""Camera Lab launcher: assess hardware, recommend, and start a deployment mode."""
from __future__ import annotations

MODES = ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker")


def recommended_mode(has_comfy: bool, want_docker: bool) -> str:
    if has_comfy and not want_docker:
        return "no-docker"
    if has_comfy and want_docker:
        return "cam-lab-only-docker"
    if not has_comfy and want_docker:
        return "full-docker"
    return "none"


def feasibility_for(min_vram_gb, recommended_vram_gb, vram_gb) -> str:
    if min_vram_gb is None and recommended_vram_gb is None:
        return "any"
    if vram_gb is None:
        return "vram-unknown"
    if min_vram_gb is not None and vram_gb < min_vram_gb:
        return "insufficient"
    if recommended_vram_gb is not None and vram_gb < recommended_vram_gb:
        return "tight"
    return "fits"


def mode_command(mode: str) -> list[list[str]]:
    native = ["python", "scripts/start_camera_lab.py", "--open"]
    if mode == "no-docker":
        return [native]
    if mode == "full-docker":
        return [["docker", "compose", "-f", "docker-compose.yml", "--env-file", "docker/compose.env", "up", "-d", "--build"]]
    if mode == "cam-lab-only-docker":
        return [["docker", "compose", "-f", "docker-compose.camera-lab-only.yml", "--env-file", "docker/compose.camera-lab-only.env", "up", "-d", "--build"]]
    if mode == "comfy-only-docker":
        return [
            ["docker", "compose", "-f", "docker-compose.comfy-only.yml", "--env-file", "docker/compose.comfy-only.env", "up", "-d", "--build"],
            native,
        ]
    raise ValueError(f"unknown mode: {mode}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add scripts/launch.py tests/test_launch.py
git commit -m "feat: launcher pure helpers (mode/feasibility/command mapping)"
```

---

### Task 3: Hardware + ComfyUI assessment

**Files:**
- Modify: `scripts/launch.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: Task 2 helpers; `detect_hardware`, `resolve_modules`, `visibility_from_object_info`, `MODULES` from `scripts.camera_lab_setup`.
- Produces:
  - `probe_comfy(candidate_urls: list[str], opener=urllib.request.urlopen) -> tuple[str | None, dict | None]` — returns the first reachable ComfyUI base URL and its parsed `/object_info`, or `(None, None)`.
  - `assess(hardware, object_info) -> dict` — returns `{"hardware": hardware, "has_comfy": bool, "modules": [{"id","ready","profile","feasibility","missing"}]}` using `resolve_modules` + `feasibility_for` on each module's chosen profile.
  - `print_assessment(assessment: dict) -> None` — human-readable report to stdout.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_launch.py`:

```python
from scripts.launch import assess, probe_comfy


class _FakeHW:
    gpu_name = "RTX 4090"
    vram_gb = 24
    os_name = "Linux"
    warnings = ()


def test_probe_comfy_returns_first_reachable():
    calls = []

    def opener(url, timeout=0):
        calls.append(url)
        if "8188" in url:
            import io, json
            return io.BytesIO(json.dumps({"UNETLoader": {}}).encode())
        raise OSError("refused")

    base, oi = probe_comfy(["http://127.0.0.1:8000/object_info", "http://127.0.0.1:8188/object_info"], opener=opener)
    assert base == "http://127.0.0.1:8188"
    assert oi == {"UNETLoader": {}}


def test_probe_comfy_none_when_all_refused():
    def opener(url, timeout=0):
        raise OSError("refused")

    assert probe_comfy(["http://127.0.0.1:8188/object_info"], opener=opener) == (None, None)


def test_assess_reports_modules():
    a = assess(_FakeHW(), object_info={"UNETLoader": {}})
    assert a["has_comfy"] is True
    assert isinstance(a["modules"], list) and a["modules"]
    row = a["modules"][0]
    assert set(row) == {"id", "ready", "profile", "feasibility", "missing"}


def test_assess_no_comfy():
    a = assess(_FakeHW(), object_info=None)
    assert a["has_comfy"] is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: FAIL — `ImportError: cannot import name 'assess'`.

- [ ] **Step 3: Implement probe + assess + print**

Add to the top of `scripts/launch.py` (imports) and body:

```python
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from camera_lab_setup.hardware import detect_hardware  # noqa: E402
from camera_lab_setup.modules import MODULES  # noqa: E402
from camera_lab_setup.resolver import resolve_modules  # noqa: E402
from camera_lab_setup.visibility import visibility_from_object_info  # noqa: E402


def probe_comfy(candidate_urls, opener=urllib.request.urlopen):
    for url in candidate_urls:
        try:
            with opener(url, timeout=5) as resp:
                data = json.load(resp)
        except (OSError, ValueError):
            continue
        base = url[: -len("/object_info")] if url.endswith("/object_info") else url
        return base, data
    return None, None


def _profile_by_id(module, profile_id):
    for p in module.model_profiles:
        if p.id == profile_id:
            return p
    return None


def assess(hardware, object_info):
    has_comfy = object_info is not None
    visibility = visibility_from_object_info(object_info) if has_comfy else None
    rows = []
    statuses = resolve_modules(MODULES, hardware, visibility) if visibility is not None else {}
    for module in MODULES:
        status = statuses.get(module.id)
        profile = _profile_by_id(module, status.profile) if status and status.profile else None
        feas = (
            feasibility_for(profile.min_vram_gb, profile.recommended_vram_gb, hardware.vram_gb)
            if profile
            else "vram-unknown"
        )
        rows.append(
            {
                "id": module.id,
                "ready": bool(status.ready) if status else False,
                "profile": status.profile if status else None,
                "feasibility": feas,
                "missing": list(status.missing) if status else [],
            }
        )
    return {"hardware": hardware, "has_comfy": has_comfy, "modules": rows}


def print_assessment(assessment) -> None:
    hw = assessment["hardware"]
    print(f"Hardware: GPU={hw.gpu_name or 'unknown'}, VRAM={hw.vram_gb or 'unknown'} GiB, OS={hw.os_name}")
    for w in hw.warnings:
        print(f"  warning: {w}")
    print(f"ComfyUI detected: {'yes' if assessment['has_comfy'] else 'no'}")
    print("Modules:")
    for m in assessment["modules"]:
        line = f"  {m['id']:8} ready={m['ready']!s:5} feasibility={m['feasibility']}"
        if m["missing"]:
            line += f" missing={len(m['missing'])}"
        print(line)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/launch.py tests/test_launch.py
git commit -m "feat: launcher hardware + comfy assessment"
```

---

### Task 4: Interactive flow, CLI, and launch dispatch

**Files:**
- Modify: `scripts/launch.py`
- Test: `tests/test_launch.py`

**Interfaces:**
- Consumes: Task 2 + Task 3 functions.
- Produces:
  - `choose_mode(assessment, input_fn=input) -> str` — asks "have comfy?" (default from `assessment["has_comfy"]`) and "use docker?", returns a mode via `recommended_mode` (or lets the user override to any of `MODES`).
  - `launch(mode, runner=subprocess.run) -> int` — checks the Docker daemon for docker modes, runs each command from `mode_command`, returns the first non-zero exit (or 0).
  - `main(argv=None) -> int` — argparse with `--mode`, `--assess-only`; wires probe → assess → print → choose/launch.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_launch.py`:

```python
from scripts.launch import choose_mode, launch, main


def test_choose_mode_uses_answers():
    answers = iter(["y", "n"])  # has comfy? yes; use docker? no
    assert choose_mode({"has_comfy": True}, input_fn=lambda _: next(answers)) == "no-docker"


def test_launch_runs_commands_and_reports_exit():
    ran = []

    class R:
        def __init__(self, code):
            self.returncode = code

    def runner(cmd, **kw):
        ran.append(cmd)
        return R(0)

    rc = launch("full-docker", runner=runner)
    assert rc == 0
    assert ran and ran[0][0] == "docker"


def test_assess_only_launches_nothing(monkeypatch, capsys):
    monkeypatch.setattr("scripts.launch.probe_comfy", lambda *a, **k: (None, None))
    monkeypatch.setattr("scripts.launch.detect_hardware", lambda **k: type("H", (), {"gpu_name": None, "vram_gb": None, "os_name": "Linux", "warnings": ()})())
    called = []
    monkeypatch.setattr("scripts.launch.launch", lambda *a, **k: called.append(a))
    rc = main(["--assess-only"])
    assert rc == 0
    assert called == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: FAIL — `ImportError: cannot import name 'choose_mode'`.

- [ ] **Step 3: Implement choose_mode + launch + main**

Add to `scripts/launch.py`:

```python
import argparse
import shutil
import subprocess


def _yes(input_fn, prompt, default):
    suffix = " [Y/n] " if default else " [y/N] "
    ans = input_fn(prompt + suffix).strip().lower()
    if not ans:
        return default
    return ans.startswith("y")


def choose_mode(assessment, input_fn=input) -> str:
    has_comfy = _yes(input_fn, "Do you already have a working ComfyUI?", bool(assessment.get("has_comfy")))
    want_docker = _yes(input_fn, "Run with Docker?", not has_comfy)
    mode = recommended_mode(has_comfy, want_docker)
    if mode == "none":
        print("No ComfyUI and no Docker: install ComfyUI first, or re-run and choose a Docker mode.")
    return mode


def _docker_available(runner) -> bool:
    if shutil.which("docker") is None:
        return False
    try:
        return runner(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        return False


def launch(mode, runner=subprocess.run) -> int:
    if mode == "none":
        return 1
    if mode != "no-docker" and not _docker_available(runner):
        print("Docker is not available/running. Start Docker Desktop and retry.", file=sys.stderr)
        return 1
    for cmd in mode_command(mode):
        result = runner(cmd)
        if result.returncode != 0:
            print(f"Command failed ({result.returncode}): {' '.join(cmd)}", file=sys.stderr)
            return result.returncode
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Assess hardware and launch Camera Lab.")
    parser.add_argument("--mode", choices=MODES, help="Skip prompts and launch this mode.")
    parser.add_argument("--assess-only", action="store_true", help="Print the assessment and exit.")
    args = parser.parse_args(argv)

    hardware = detect_hardware(repo_root=ROOT, comfy_root=ROOT)
    base, object_info = probe_comfy(
        ["http://127.0.0.1:8188/object_info", "http://127.0.0.1:8000/object_info"]
    )
    assessment = assess(hardware, object_info)
    print_assessment(assessment)
    if args.assess_only:
        return 0
    mode = args.mode or choose_mode(assessment)
    return launch(mode)


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest -p no:cacheprovider tests/test_launch.py -q`
Expected: PASS.

- [ ] **Step 5: Full-suite regression check**

Run: `python -m pytest -p no:cacheprovider -q`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add scripts/launch.py tests/test_launch.py
git commit -m "feat: launcher interactive flow, CLI, and launch dispatch"
```

---

### Task 5: Document the launcher

**Files:**
- Modify: `docker/README.md`

**Interfaces:**
- Consumes: the finished `scripts/launch.py` and the 4 modes.
- Produces: a "Launcher" section documenting usage.

- [ ] **Step 1: Add the launcher section**

Append to `docker/README.md`:

```markdown
## Launcher (recommended entry point)

Instead of picking a compose file by hand, run the launcher on the host — it
detects your GPU/VRAM, tells you which modules are feasible and what your ComfyUI
is missing, then starts the right mode:

```bash
python scripts/launch.py            # interactive
python scripts/launch.py --assess-only   # just print the assessment
python scripts/launch.py --mode full-docker   # skip prompts, launch a mode
```

Modes:
- `no-docker` — native camera-lab against your existing ComfyUI.
- `full-docker` — ComfyUI + camera-lab, both in containers.
- `comfy-only-docker` — ComfyUI in a container, camera-lab native.
- `cam-lab-only-docker` — camera-lab in a container against your existing ComfyUI
  (that ComfyUI must listen on `0.0.0.0`, via `--listen`).

The launcher only **recommends** models (which quant fits your VRAM, what is
missing); it never downloads them.
```

- [ ] **Step 2: Commit**

```bash
git add docker/README.md
git commit -m "docs: document the camera-lab launcher and modes"
```

---

## Self-Review

**Spec coverage:**
- Host-native assessment (real GPU) → Task 3 (`detect_hardware` on host) + Task 4 `main`. ✓
- Feasibility + model recommendation → Task 2 `feasibility_for`, Task 3 `assess`/`print_assessment`. ✓
- Ask have-comfy / want-docker → Task 4 `choose_mode`. ✓
- 4 modes with recommended default → Task 2 `recommended_mode`, Task 4. ✓
- Actually launch → Task 4 `launch` + Task 2 `mode_command`. ✓
- New `docker-compose.comfy-only.yml` → Task 1. ✓
- Recommend-only (no download) → nothing in the plan downloads; `assess` only reports `missing`. ✓
- `--mode` / `--assess-only`, no `--yes` → Task 4 argparse. ✓
- Error handling: GPU unknown (feasibility "vram-unknown"/print warning) Task 3; docker down (`_docker_available`) Task 4; comfy-not-reachable surfaces as `has_comfy=False` → `choose_mode` guidance. ✓
- Testing: pure helpers + assess with fakes → Tasks 2-4; launch host-manual (not automated) — the plan tests `launch` with a fake runner. ✓

**Placeholder scan:** No TBD/TODO. Docker `up` / native start are real commands; the actual container start is exercised host-manually, but `launch` logic is unit-tested with a fake runner.

**Type consistency:** `recommended_mode`, `feasibility_for`, `mode_command`, `probe_comfy`, `assess`, `print_assessment`, `choose_mode`, `launch`, `main` are defined once and consumed with matching signatures across tasks. `assess` row keys `{id,ready,profile,feasibility,missing}` match `print_assessment` and the Task 3 test. `mode_command` returns `list[list[str]]` consumed by `launch`.
