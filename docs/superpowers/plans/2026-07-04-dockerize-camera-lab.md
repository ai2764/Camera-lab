# Dockerize Camera Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Camera Lab as a two-service `docker compose` stack (a CPU camera-lab server + an isolated GPU ComfyUI with pinned custom nodes) so a user runs `docker compose up` without touching their existing native ComfyUI.

**Architecture:** `docker-compose.yml` defines `camera-lab` (python:slim + Pillow, serves the frontend/API, `COMFYUI_URL=http://comfyui:8188`) and `comfyui` (CUDA base, pinned ComfyUI + the custom nodes Camera Lab's workflows need, GPU via nvidia runtime). The host `models/` directory and shared `input/`/`output/` volumes are bind/named-mounted; the installer's assessment half survives as a container-side `check_setup` command. Env/deps/nodes install is now owned by the images.

**Tech Stack:** Docker + docker compose (nvidia runtime), Python 3.12 stdlib + Pillow, ComfyUI (`comfyanonymous/ComfyUI`), pytest for the pure-Python helpers.

## Global Constraints

- ComfyUI is pinned to `comfyanonymous/ComfyUI@2f4c4e983c63dc60ae781bcca01e0e17f4f404d6` (matches the reference install `~/dev/ComfyUI-scail`).
- Python in both images: 3.12.
- camera-lab server entrypoint is `server/camera_lab_server.py`, which already accepts `--host` (default `0.0.0.0`) and `--port` (default `1234`). In Docker run it as `--host 0.0.0.0 --port 8000`.
- camera-lab's Python dependency surface is `requirements.txt` (currently just `Pillow`) — do NOT add others.
- The `comfyui` service is the **only** GPU service. `camera-lab` is CPU-only.
- The WhatDreamsCost Director node comes from the user's fork `https://github.com/ai2764/WhatDreamsCost-ComfyUI` (not the upstream), per project convention.
- Casting/CosyVoice TTS is OUT of scope. LLM stays external (env vars only).
- Model download beyond models that already carry a `source_url` is OUT of scope (separate follow-up spec).
- ComfyUI shared dirs (from `dependency-manifest.json` `required_paths`): `input`, `output`, `models`, `user/default/workflows`.

---

## File Structure

- `scripts/docker_node_check.py` — **create**: pure helpers to (a) list custom node `class_type`s used by `workflows/app/*.json` given a class→provider map, and (b) assert a ComfyUI `/object_info` payload contains a required set. No Docker/network deps → unit-testable.
- `tests/test_docker_node_check.py` — **create**: unit tests for the two helpers.
- `docker/nodes.lock` — **create**: `dir_name <TAB> repo_url <TAB> commit` per bundled custom node.
- `docker/comfyui.Dockerfile` — **create**: CUDA base → Python 3.12 → torch → pinned ComfyUI → nodes from `nodes.lock` → entrypoint.
- `docker/entrypoint-comfyui.sh` — **create**: GPU/CUDA preflight (clear message on failure) then launch ComfyUI on `0.0.0.0:8188`.
- `docker/camera-lab.Dockerfile` — **create**: `python:3.12-slim` → repo → `pip install -r requirements.txt` → launch the server on `0.0.0.0:8000`.
- `docker-compose.yml` — **create**: the two services, GPU, volumes, healthcheck, ports.
- `.dockerignore` — **create**: exclude `.git`, `tasks/`, `node_modules`, models, scratch.
- `docker/compose.env.example` — **create**: `MODELS_DIR`, `CAMERA_LAB_PORT`, `COMFYUI_URL`, LLM vars.
- `scripts/docker_node_smoke.py` — **create**: fetch a live comfyui `/object_info` and call the Task-1 assert helper; exit non-zero on missing nodes.
- `scripts/check_setup.py` — **modify**: allow the setup check to pass from environment variables when no `.env` file is present (container case).
- `tests/test_check_setup_env.py` — **create**: unit test for the env-only path.
- `docker/README.md` — **create**: prerequisites, usage, troubleshooting.

---

### Task 1: Node-set helpers + `docker/nodes.lock`

**Files:**
- Create: `scripts/docker_node_check.py`
- Create: `tests/test_docker_node_check.py`
- Create: `docker/nodes.lock`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `custom_classes_in_workflows(workflows_dir: Path, provider_map: dict[str, str]) -> dict[str, str]`
    — returns `{class_type: provider_dir}` for every node `type`/`class_type` appearing in
    `*.json` under `workflows_dir` that is present in `provider_map` (drops built-ins and
    subgraph UUID ids, which are simply absent from `provider_map`).
  - `assert_object_info_has(required: set[str], object_info: dict) -> list[str]` — returns the
    sorted list of `required` class names **missing** from `object_info` keys (empty list = all present).
  - `nodes_lock_dirs(lock_path: Path) -> set[str]` — the set of `dir_name`s declared in `nodes.lock`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_docker_node_check.py`:

```python
import json
from pathlib import Path

from scripts.docker_node_check import (
    assert_object_info_has,
    custom_classes_in_workflows,
    nodes_lock_dirs,
)


def _write_wf(tmp_path: Path, name: str, types: list[str]) -> None:
    nodes = [{"type": t} for t in types]
    (tmp_path / name).write_text(json.dumps({"nodes": nodes}), encoding="utf-8")


def test_custom_classes_filters_by_provider_map(tmp_path):
    _write_wf(tmp_path, "a.json", ["LTXDirector", "KSampler", "b8-uuid-1234"])
    provider = {"LTXDirector": "WhatDreamsCost-ComfyUI"}  # KSampler builtin, uuid absent
    result = custom_classes_in_workflows(tmp_path, provider)
    assert result == {"LTXDirector": "WhatDreamsCost-ComfyUI"}


def test_assert_object_info_has_reports_missing():
    oi = {"LTXDirector": {}, "KSampler": {}}
    assert assert_object_info_has({"LTXDirector"}, oi) == []
    assert assert_object_info_has({"LTXDirector", "HYMotionGenerate"}, oi) == ["HYMotionGenerate"]


def test_nodes_lock_dirs_parses_tab_rows(tmp_path):
    lock = tmp_path / "nodes.lock"
    lock.write_text(
        "# comment\n"
        "ComfyUI-GGUF\thttps://github.com/city96/ComfyUI-GGUF\tabc123\n"
        "\n"
        "comfyui-kjnodes\thttps://github.com/kijai/ComfyUI-KJNodes\tdef456\n",
        encoding="utf-8",
    )
    assert nodes_lock_dirs(lock) == {"ComfyUI-GGUF", "comfyui-kjnodes"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_docker_node_check.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.docker_node_check'`.

- [ ] **Step 3: Implement the helpers**

Create `scripts/docker_node_check.py`:

```python
"""Pure helpers for deriving and verifying the Docker ComfyUI custom-node set."""
from __future__ import annotations

import json
from pathlib import Path


def _iter_node_types(data: object):
    if isinstance(data, dict):
        nodes = data.get("nodes")
        if isinstance(nodes, list):
            for n in nodes:
                if isinstance(n, dict):
                    t = n.get("type") or n.get("class_type")
                    if isinstance(t, str):
                        yield t
        else:  # API-format dict: {id: {"class_type": ...}}
            for n in data.values():
                if isinstance(n, dict) and isinstance(n.get("class_type"), str):
                    yield n["class_type"]


def custom_classes_in_workflows(workflows_dir: Path, provider_map: dict[str, str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for path in sorted(Path(workflows_dir).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for t in _iter_node_types(data):
            if t in provider_map:
                found[t] = provider_map[t]
    return found


def assert_object_info_has(required: set[str], object_info: dict) -> list[str]:
    keys = set(object_info or {})
    return sorted(required - keys)


def nodes_lock_dirs(lock_path: Path) -> set[str]:
    dirs: set[str] = set()
    for line in Path(lock_path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        dirs.add(line.split("\t")[0].strip())
    return dirs
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest -p no:cacheprovider tests/test_docker_node_check.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Derive the provider map from the reference install and author `nodes.lock`**

Run this derivation against the reference ComfyUI (writes `class -> providing dir`):

```bash
python - <<'PY'
import json, re, glob, os
from pathlib import Path
cn = Path(os.path.expanduser("~/dev/ComfyUI-scail/custom_nodes"))
# class -> dir, by scanning NODE_CLASS_MAPPINGS registrations across custom nodes
prov = {}
for d in sorted(p for p in cn.iterdir() if p.is_dir()):
    for py in d.rglob("*.py"):
        try:
            src = py.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in re.finditer(r'NODE_CLASS_MAPPINGS\s*(?:\[|update\(|=)\s*', src):
            pass
        for m in re.finditer(r'["\']([A-Za-z0-9_\-]+)["\']\s*:', src):
            prov.setdefault(m.group(1), d.name)
# classes actually used in workflows
used = set()
for f in glob.glob("workflows/app/*.json"):
    try: data = json.load(open(f, encoding="utf-8"))
    except Exception: continue
    for n in (data.get("nodes") or []):
        t = n.get("type") or n.get("class_type")
        if t: used.add(t)
    if "nodes" not in data:
        for n in data.values():
            if isinstance(n, dict) and n.get("class_type"): used.add(n["class_type"])
needed_dirs = sorted({prov[c] for c in used if c in prov})
print("NEEDED CUSTOM-NODE DIRS:")
for d in needed_dirs: print(" ", d)
print("\nUNRESOLVED classes (likely builtins or subgraphs):")
print(" ", sorted(c for c in used if c not in prov)[:40])
PY
```

Note: the regex heuristic over-captures; treat its `NEEDED CUSTOM-NODE DIRS` as the candidate
list and confirm each dir actually exposes a class used by the workflows (e.g. `BerniniConditioning`,
`HYMotionGenerate`, `LTXDirector`, `*GGUF`). Then resolve each dir's upstream `repo_url` and
`commit`. For dirs with a `.git`, use `git -C <dir> remote get-url origin` and `git -C <dir> rev-parse HEAD`.
For dirs without `.git`, pin the current upstream HEAD via `git ls-remote <repo_url> HEAD`.

Create `docker/nodes.lock` (tab-separated `dir<TAB>repo<TAB>commit`). Known values captured from
the reference install and project convention — fill each `commit` from the commands above:

```text
# dir<TAB>repo_url<TAB>commit  (ComfyUI custom nodes bundled into the comfyui image)
ComfyUI-GGUF	https://github.com/city96/ComfyUI-GGUF	<git ls-remote HEAD>
ComfyUI-LTXVideo	https://github.com/Lightricks/ComfyUI-LTXVideo	<git ls-remote HEAD>
WhatDreamsCost-ComfyUI	https://github.com/ai2764/WhatDreamsCost-ComfyUI	<git ls-remote HEAD>
comfyui-kjnodes	https://github.com/kijai/ComfyUI-KJNodes	<git ls-remote HEAD>
comfyui_essentials	https://github.com/cubiq/ComfyUI_essentials	<git ls-remote HEAD>
rgthree-comfy	https://github.com/rgthree/rgthree-comfy	<git ls-remote HEAD>
ComfyUI-VideoHelperSuite	https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite	4ee72c0
ComfyUI-HY-Motion1	https://github.com/jtydhr88/ComfyUI-HY-Motion1	1342cd8
ComfyUI-mesh2motion	https://github.com/jtydhr88/ComfyUI-mesh2motion	11fe6b7
ComfyUI-Kimodo	https://github.com/jtydhr88/ComfyUI-Kimodo	9e758bc
ComfyUI-Licon-MSR	https://github.com/liconstudio/ComfyUI-Licon-MSR	cc4f26f
```

Include a row for any additional dir the derivation flags (e.g. `ComfyUI-Yedp-Action-Director`,
`workflow_compat_nodes`). If `workflow_compat_nodes` is vendored inside this repo rather than an
upstream repo, do NOT add a lock row for it — instead note it is `COPY`ed from the repo in Task 2.
Drop any candidate dir whose only classes are unused/builtin after the confirmation step.

- [ ] **Step 6: Add a coverage test tying workflows → nodes.lock**

Append to `tests/test_docker_node_check.py`:

```python
def test_every_workflow_custom_class_has_a_lock_entry():
    """Guard: nodes.lock must cover every custom-node dir the workflows depend on."""
    repo = Path(__file__).resolve().parents[1]
    lock = repo / "docker" / "nodes.lock"
    map_path = repo / "docker" / "provider_map.json"  # written alongside nodes.lock in Step 5
    if not (lock.exists() and map_path.exists()):
        import pytest
        pytest.skip("docker/nodes.lock or provider_map.json not present yet")
    provider = json.loads(map_path.read_text(encoding="utf-8"))
    used = custom_classes_in_workflows(repo / "workflows" / "app", provider)
    lock_dirs = nodes_lock_dirs(lock)
    vendored = {"workflow_compat_nodes"}  # copied from repo, not cloned
    missing = sorted({d for d in used.values() if d not in lock_dirs and d not in vendored})
    assert missing == [], f"custom-node dirs used by workflows but absent from nodes.lock: {missing}"
```

In Step 5, also write the confirmed `{class: dir}` map to `docker/provider_map.json` so this test
and the smoke script share one source of truth.

- [ ] **Step 7: Run the tests**

Run: `python -m pytest -p no:cacheprovider tests/test_docker_node_check.py -q`
Expected: PASS (coverage test runs once `nodes.lock` + `provider_map.json` exist; otherwise skips).

- [ ] **Step 8: Commit**

```bash
git add scripts/docker_node_check.py tests/test_docker_node_check.py docker/nodes.lock docker/provider_map.json
git commit -m "feat: docker node-set helpers and pinned nodes.lock"
```

---

### Task 2: `comfyui` image (Dockerfile + GPU-preflight entrypoint)

**Files:**
- Create: `docker/comfyui.Dockerfile`
- Create: `docker/entrypoint-comfyui.sh`

**Interfaces:**
- Consumes: `docker/nodes.lock` (Task 1).
- Produces: an image that on run launches ComfyUI on `0.0.0.0:8188` with all bundled nodes loaded,
  and whose entrypoint fails fast with a legible message when the GPU is not visible.

**Base-image coverage (confirmed during Task 1):** `BerniniConditioning` (all `wan22_bernini_*`
workflows) and the LTX core nodes (`LTXVConditioning`, `EmptyLTXVLatentVideo`, …) are **built-in
`comfy_extras`** (`nodes_bernini.py`, `nodes_lt*.py`) present in upstream `comfyanonymous/ComfyUI`
at the pinned commit `2f4c4e983c...`. So the base clone covers them — no custom node is needed for
Bernini/LTX, and `ComfyUI-LTXVideo` is correctly absent from `nodes.lock` (its extra classes are
unused by these workflows). Do NOT add a fork/patch for Bernini.

- [ ] **Step 0: Vendor `workflow_compat_nodes` into the repo**

`GetNode`/`SetNode` (used across the workflows) are provided by `workflow_compat_nodes`, which lives
only in the reference install (no upstream git). Vendor it into this repo so the Dockerfile can copy
it in:

```bash
cp -r ~/dev/ComfyUI-scail/custom_nodes/workflow_compat_nodes custom_nodes/workflow_compat_nodes
git add custom_nodes/workflow_compat_nodes
```

Verify it registers `GetNode` and `SetNode` (grep its `NODE_CLASS_MAPPINGS`). Commit it with this
task. (The Dockerfile's conditional COPY block then finds it under `custom_nodes/`.)

- [ ] **Step 1: Write the GPU-preflight entrypoint**

Create `docker/entrypoint-comfyui.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[comfyui] GPU preflight..."
if ! python -c "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"; then
  cat >&2 <<'MSG'
[comfyui] ERROR: no CUDA GPU visible inside the container.
  The comfyui service needs GPU passthrough. Check host prerequisites:
    - Linux:   install nvidia-container-toolkit and restart docker
    - Windows: Docker Desktop + WSL2 + a recent NVIDIA driver
  Verify with:  docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
MSG
  exit 1
fi
echo "[comfyui] GPU OK: $(python -c 'import torch; print(torch.cuda.get_device_name(0))')"

exec python main.py --listen 0.0.0.0 --port 8188 "$@"
```

- [ ] **Step 2: Write the Dockerfile**

Create `docker/comfyui.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ARG COMFYUI_COMMIT=2f4c4e983c63dc60ae781bcca01e0e17f4f404d6
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu124
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-pip git ca-certificates \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/comfyanonymous/ComfyUI.git ComfyUI \
    && git -C ComfyUI checkout ${COMFYUI_COMMIT}
WORKDIR /opt/ComfyUI

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir torch torchvision torchaudio --index-url ${TORCH_INDEX} \
    && python -m pip install --no-cache-dir -r requirements.txt

# Bundle pinned custom nodes from nodes.lock, installing each node's requirements.
COPY docker/nodes.lock /tmp/nodes.lock
RUN set -eux; \
    while IFS=$'\t' read -r dir repo commit; do \
      case "$dir" in ''|\#*) continue;; esac; \
      git clone "$repo" "custom_nodes/$dir"; \
      git -C "custom_nodes/$dir" checkout "$commit"; \
      if [ -f "custom_nodes/$dir/requirements.txt" ]; then \
        python -m pip install --no-cache-dir -r "custom_nodes/$dir/requirements.txt"; \
      fi; \
    done < /tmp/nodes.lock

# If workflow_compat_nodes is vendored in the app repo, copy it in:
COPY --chown=root:root . /tmp/app-repo
RUN if [ -d /tmp/app-repo/custom_nodes/workflow_compat_nodes ]; then \
      cp -r /tmp/app-repo/custom_nodes/workflow_compat_nodes custom_nodes/; \
    fi; rm -rf /tmp/app-repo

COPY docker/entrypoint-comfyui.sh /usr/local/bin/entrypoint-comfyui.sh
RUN chmod +x /usr/local/bin/entrypoint-comfyui.sh
EXPOSE 8188
ENTRYPOINT ["/usr/local/bin/entrypoint-comfyui.sh"]
```

Note: if `pip install torch ... --index-url cu124` cannot resolve, adjust `TORCH_INDEX` to the
matching CUDA tag (e.g. `cu126`/`cu128`) via `--build-arg`; the base image CUDA (12.4.1) and the
wheel tag must agree. The `COPY . /tmp/app-repo` only lands the vendored node dir; `.dockerignore`
(Task 4) keeps models/tasks/.git out of build context.

- [ ] **Step 3: Build the image (Docker + GPU host required)**

Run: `docker build -f docker/comfyui.Dockerfile -t camera-lab-comfyui:dev .`
Expected: build completes; final image tagged `camera-lab-comfyui:dev`.

- [ ] **Step 4: Smoke-run and check nodes load**

Run:
```bash
docker run --rm --gpus all -p 8188:8188 \
  -v "$HOME/dev/ComfyUI-scail/models:/opt/ComfyUI/models:ro" \
  camera-lab-comfyui:dev &
sleep 30
curl -sf http://127.0.0.1:8188/object_info > /tmp/oi.json && echo "object_info OK"
```
Expected: `[comfyui] GPU OK: ...` in logs and `object_info OK`. Stop the container afterward.

- [ ] **Step 5: Commit**

```bash
git add docker/comfyui.Dockerfile docker/entrypoint-comfyui.sh
git commit -m "feat: comfyui docker image with pinned nodes and GPU preflight"
```

---

### Task 3: `camera-lab` image

**Files:**
- Create: `docker/camera-lab.Dockerfile`

**Interfaces:**
- Consumes: `requirements.txt`, `server/camera_lab_server.py` (existing).
- Produces: an image that serves the frontend/API on `0.0.0.0:8000`.

- [ ] **Step 1: Write the Dockerfile**

Create `docker/camera-lab.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["python", "server/camera_lab_server.py", "--host", "0.0.0.0", "--port", "8000"]
```

Note: `ffmpeg` is included because the server shells out to it for audio staging/gain
(`stage_director_audio`). Keep the `COPY . .` last so code changes don't bust the pip layer.

- [ ] **Step 2: Build the image**

Run: `docker build -f docker/camera-lab.Dockerfile -t camera-lab-server:dev .`
Expected: build completes.

- [ ] **Step 3: Smoke-run the server standalone**

Run:
```bash
docker run --rm -p 8000:8000 camera-lab-server:dev &
sleep 5
curl -sf http://127.0.0.1:8000/api/config | head -c 200 && echo " ... /api/config OK"
```
Expected: JSON config returned (the `comfy` block will report unreachable when run standalone —
that is fine here; wiring is Task 4). Stop the container afterward.

- [ ] **Step 4: Commit**

```bash
git add docker/camera-lab.Dockerfile
git commit -m "feat: camera-lab server docker image"
```

---

### Task 4: Compose stack + `.dockerignore` + env example

**Files:**
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `docker/compose.env.example`

**Interfaces:**
- Consumes: both images (Tasks 2, 3).
- Produces: a `docker compose up` that starts comfyui (healthy) then camera-lab, with camera-lab
  reaching comfyui over the compose network; shared `input`/`output` volumes and a host models bind.

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore`:

```text
.git
.gitignore
tasks/
node_modules/
**/__pycache__/
*.pyc
.superpowers/
docs/superpowers/
tts/models/
models/
*.mp4
*.wav
```

- [ ] **Step 2: Write the compose env example**

Create `docker/compose.env.example`:

```text
# Absolute host path to your existing ComfyUI models directory (bind-mounted read-only).
MODELS_DIR=/absolute/path/to/ComfyUI/models
# Host port the Camera Lab UI is published on.
CAMERA_LAB_PORT=8000
# External LLM endpoint for the Casting dialogue analysis (optional).
LLM_URL=http://host.docker.internal:1234/v1
LLM_MODEL=gpt-oss-20b
LLM_API_KEY=
```

- [ ] **Step 3: Write `docker-compose.yml`**

Create `docker-compose.yml`:

```yaml
services:
  comfyui:
    build:
      context: .
      dockerfile: docker/comfyui.Dockerfile
    volumes:
      - ${MODELS_DIR:?set MODELS_DIR in docker/compose.env}:/opt/ComfyUI/models:ro
      - comfy_input:/opt/ComfyUI/input
      - comfy_output:/opt/ComfyUI/output
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

  camera-lab:
    build:
      context: .
      dockerfile: docker/camera-lab.Dockerfile
    depends_on:
      comfyui:
        condition: service_healthy
    environment:
      COMFYUI_URL: http://comfyui:8188
      COMFY_INPUT_DIR: /opt/ComfyUI/input
      COMFY_OUTPUT_DIR: /opt/ComfyUI/output
      LLM_URL: ${LLM_URL:-}
      LLM_MODEL: ${LLM_MODEL:-}
      LLM_API_KEY: ${LLM_API_KEY:-}
    volumes:
      - comfy_input:/opt/ComfyUI/input
      - comfy_output:/opt/ComfyUI/output
      - ./tasks:/app/tasks
    ports:
      - "${CAMERA_LAB_PORT:-8000}:8000"

volumes:
  comfy_input:
  comfy_output:
```

Note: camera-lab and comfyui mount the **same** `comfy_input`/`comfy_output` named volumes at the
same paths so camera-lab's staged input files land where comfyui reads and generated output is
shared back. `COMFY_INPUT_DIR`/`COMFY_OUTPUT_DIR` env are read in Task 5's verification of how the
server resolves `COMFY_INPUT`; if the server derives those from `COMFYUI_ROOT` instead, set
`COMFYUI_ROOT=/opt/ComfyUI` here and mount the volumes under it — confirm during Step 5.

- [ ] **Step 4: Validate compose config (no Docker daemon needed for parse)**

Run: `MODELS_DIR=/tmp/models docker compose --env-file /dev/null config -q && echo "compose OK"`
Expected: `compose OK` (compose file parses and interpolates).

- [ ] **Step 5: Confirm how the server resolves the ComfyUI input/output dirs**

Inspect `server/camera_lab_server.py` around the `COMFY_INPUT` / `COMFY_CONFIG["root"]` definitions
(≈lines 60-110). Determine whether staged-media paths come from `COMFYUI_ROOT` or a dedicated env.
If they derive from `COMFYUI_ROOT`, change the compose `camera-lab.environment` to set
`COMFYUI_ROOT: /opt/ComfyUI` and mount `comfy_input`/`comfy_output` under `/opt/ComfyUI/input` and
`/opt/ComfyUI/output` in the camera-lab service (they already are). Remove `COMFY_INPUT_DIR`/
`COMFY_OUTPUT_DIR` if unused. Commit the corrected compose.

- [ ] **Step 6: Bring up the stack and verify wiring (Docker + GPU host required)**

Run:
```bash
cp docker/compose.env.example docker/compose.env   # then edit MODELS_DIR
docker compose --env-file docker/compose.env up -d --build
# wait for comfyui healthy, then:
curl -sf "http://127.0.0.1:${CAMERA_LAB_PORT:-8000}/api/config" | python -c "import json,sys; d=json.load(sys.stdin); print('comfy.ok=', d.get('comfy',{}).get('ok'))"
```
Expected: `comfy.ok= True` (camera-lab reached comfyui over the network).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .dockerignore docker/compose.env.example
git commit -m "feat: two-service docker compose stack for camera-lab + comfyui"
```

---

### Task 5: In-container setup/assessment command

**Files:**
- Modify: `scripts/check_setup.py`
- Create: `tests/test_check_setup_env.py`

**Interfaces:**
- Consumes: existing `scripts/check_setup.py`, `scripts/camera_lab_common.py` env loaders.
- Produces: `check_setup` passes its `.env` check when `COMFYUI_URL` (and, where relevant,
  `COMFYUI_ROOT`) are present in the process environment even if no `.env` file exists, so
  `docker compose run --rm camera-lab python scripts/check_setup.py` works in the container.

- [ ] **Step 1: Read the current check to find the `.env` gate**

Read `scripts/check_setup.py` (all 83 lines). Locate the line:
`add_check(checks, ".env", ENV_PATH.exists(), "...")`. This fails in-container because there is no
`.env` file — env vars are injected by compose instead.

- [ ] **Step 2: Write the failing test**

Create `tests/test_check_setup_env.py`:

```python
import importlib
import os


def test_env_check_passes_from_environment(monkeypatch, tmp_path):
    # No .env file, but COMFYUI_URL is set in the environment (container case).
    monkeypatch.setenv("COMFYUI_URL", "http://comfyui:8188")
    monkeypatch.delenv("COMFYUI_ROOT", raising=False)
    import scripts.check_setup as cs
    importlib.reload(cs)
    assert cs.env_config_present() is True


def test_env_check_fails_without_file_or_env(monkeypatch):
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    monkeypatch.delenv("COMFYUI_ROOT", raising=False)
    import scripts.check_setup as cs
    importlib.reload(cs)
    # ENV_PATH may or may not exist in the dev tree; force the file-absent branch.
    monkeypatch.setattr(cs.ENV_PATH, "exists", lambda: False, raising=False)
    assert cs.env_config_present() is False
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest -p no:cacheprovider tests/test_check_setup_env.py -q`
Expected: FAIL — `AttributeError: module 'scripts.check_setup' has no attribute 'env_config_present'`.

- [ ] **Step 4: Add `env_config_present()` and use it in the check**

In `scripts/check_setup.py`, add a helper near the top (after imports) and replace the `.env` check:

```python
def env_config_present() -> bool:
    """True if a .env file exists OR the key config is supplied via the environment (container)."""
    if ENV_PATH.exists():
        return True
    return bool(os.environ.get("COMFYUI_URL") or os.environ.get("COMFYUI_ROOT"))
```

Then change the `.env` check line to:

```python
    add_check(
        checks,
        ".env / env config",
        env_config_present(),
        "provide COMFYUI_URL/COMFYUI_ROOT via .env or the container environment",
    )
```

Ensure `import os` is present at the top of the file (add it if missing).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest -p no:cacheprovider tests/test_check_setup_env.py -q`
Expected: PASS (2 passed).

- [ ] **Step 6: Verify the assessment command runs in-container (Docker host)**

Run: `docker compose --env-file docker/compose.env run --rm camera-lab python scripts/check_setup.py`
Expected: the check prints per-item status (`.env / env config` passes from the compose env) and
reaches ComfyUI at `http://comfyui:8188`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check_setup.py tests/test_check_setup_env.py
git commit -m "feat: check_setup passes from container env; usable as docker assessment command"
```

---

### Task 6: Node-availability smoke script + docs

**Files:**
- Create: `scripts/docker_node_smoke.py`
- Create: `docker/README.md`

**Interfaces:**
- Consumes: `scripts/docker_node_check.py` (`assert_object_info_has`), `docker/provider_map.json`
  (Task 1), a live comfyui `/object_info` URL.
- Produces: a script that exits non-zero listing any required custom node class missing from the
  running comfyui — the guardrail against node-version drift.

- [ ] **Step 1: Write the smoke script**

Create `scripts/docker_node_smoke.py`:

```python
"""Assert the running ComfyUI exposes every custom node class the app's workflows need."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.docker_node_check import assert_object_info_has, custom_classes_in_workflows  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8188"
    provider = json.loads((REPO / "docker" / "provider_map.json").read_text(encoding="utf-8"))
    required = set(custom_classes_in_workflows(REPO / "workflows" / "app", provider))
    with urllib.request.urlopen(f"{url}/object_info", timeout=30) as resp:
        object_info = json.load(resp)
    missing = assert_object_info_has(required, object_info)
    if missing:
        print("MISSING custom node classes in ComfyUI:", ", ".join(missing), file=sys.stderr)
        return 1
    print(f"OK: all {len(required)} required custom node classes present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Verify it imports and errors cleanly without a server**

Run: `python scripts/docker_node_smoke.py http://127.0.0.1:59999`
Expected: a connection error/traceback or non-zero exit (no server there) — confirms wiring; it
must not fail on import or on reading `provider_map.json`.

- [ ] **Step 3: Run the smoke against the live stack (Docker host)**

Run: `docker compose --env-file docker/compose.env exec -T camera-lab python scripts/docker_node_smoke.py http://comfyui:8188`
Expected: `OK: all N required custom node classes present.`

- [ ] **Step 4: Write `docker/README.md`**

Create `docker/README.md`:

```markdown
# Camera Lab — Docker

Run Camera Lab as an isolated two-service stack. Your existing native ComfyUI is **not** touched;
this brings up its own pinned ComfyUI with the custom nodes Camera Lab needs.

## Prerequisites (one-time host setup)

- Docker + docker compose.
- NVIDIA GPU passthrough for Docker:
  - **Linux:** install `nvidia-container-toolkit`, then restart Docker.
  - **Windows:** Docker Desktop + WSL2 + a recent NVIDIA driver.
  - Verify: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`
- Your ComfyUI **models** already downloaded on the host (they are mounted, not re-downloaded).

## Configure

```bash
cp docker/compose.env.example docker/compose.env
# edit docker/compose.env: set MODELS_DIR to your host models path
```

## Run

```bash
docker compose --env-file docker/compose.env up -d --build
# open http://localhost:8000  (or your CAMERA_LAB_PORT)
```

## Assess / troubleshoot

- Which modules are ready / what models are missing:
  `docker compose --env-file docker/compose.env run --rm camera-lab python scripts/check_setup.py`
- Verify all required custom nodes loaded:
  `docker compose --env-file docker/compose.env exec -T camera-lab python scripts/docker_node_smoke.py http://comfyui:8188`
- **GPU not visible:** the `comfyui` container exits with a message pointing at the toolkit/WSL2
  prerequisites above. Fix the host, then `docker compose ... up -d` again.
- **Model missing at generation time:** drop the file into your `MODELS_DIR` (no rebuild needed).

## Out of scope (v1)

- Casting / CosyVoice TTS (planned later).
- Automatic model downloading beyond models that already carry a `source_url`.
- LLM runs externally: point `LLM_URL` at your own endpoint.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/docker_node_smoke.py docker/README.md
git commit -m "feat: docker node-availability smoke check and README"
```

---

## Self-Review

**Spec coverage:**
- Two-service compose (comfyui GPU + camera-lab CPU) → Tasks 2, 3, 4. ✓
- Image bakes pinned ComfyUI + all custom nodes from workflows → Tasks 1 (nodes.lock), 2. ✓
- Host models bind-mounted → Task 4 compose. ✓
- Shared ComfyUI input/output dirs (camera-lab writes staged media where comfyui reads) →
  Task 4 named volumes + Task 5 Step 5 path confirmation. ✓
- GPU on comfyui only + preflight with clear message → Task 2 entrypoint, Task 4 deploy block. ✓
- Node-availability smoke test reusing required-node data → Tasks 1 + 6. ✓
- Container-side assessment command (hardware/resolver/missing) → Task 5 (`check_setup`) + README. ✓
- LLM external, Casting/CosyVoice deferred, model-URL/consent deferred → README "Out of scope",
  compose LLM env. ✓
- Wiring test (`/api/config` `comfy.ok`) → Task 4 Step 6. ✓

**Placeholder scan:** The `<git ls-remote HEAD>` markers in `nodes.lock` are resolved by the
commands in Task 1 Step 5 (each becomes a concrete SHA before commit) — not left in the file. No
other TODO/TBD. Image build/run steps that need a Docker+GPU host are labelled as such; their
automatable counterparts (`pytest`, `docker compose config`) are the TDD core.

**Type consistency:** `custom_classes_in_workflows`, `assert_object_info_has`, `nodes_lock_dirs`
are defined in Task 1 and used with the same signatures in Tasks 1 (tests) and 6 (smoke). The
`provider_map.json` produced in Task 1 Step 6 is consumed in Task 6. `env_config_present()` defined
and used within Task 5.
