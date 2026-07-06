# Dockerize Camera Lab — Design

> Status: design (brainstormed 2026-07-04). Implementation plan to follow via writing-plans.
> Branch: `feature/modular-installer`.

## Goal

Ship Camera Lab as a **one-command `docker compose up`** so a user can run it without
touching their existing native ComfyUI. The container stack bundles its **own** isolated
ComfyUI + the pinned custom nodes Camera Lab's workflows need, so the user's working
ComfyUI (and its fragile dependency tree) is never modified.

## Why (problem)

- Camera Lab's own server is dependency-trivial (`requirements.txt` = just `Pillow` + Python
  stdlib) and connects to ComfyUI purely over HTTP (`COMFYUI_URL`). It does **not** pip-install
  into ComfyUI's environment.
- The real dependency-conflict risk is the **ComfyUI custom nodes** Camera Lab's workflows
  require (WhatDreamsCost, ComfyUI-GGUF, LTXVideo, KJNodes, HY-Motion, Bernini/WAN, …). Each
  pins its own torch/transformers/etc.; installing them into an existing ComfyUI can break it.
- Therefore the thing to isolate is **ComfyUI + its custom nodes**, not Camera Lab itself.
  Only the ComfyUI container needs the GPU.

## Scope (v1)

- **In:** two-service `docker compose` (camera-lab + comfyui); comfyui image bakes a pinned
  ComfyUI + all custom nodes referenced by any bundled `workflows/app/*.json`; host models
  directory bind-mounted; host `tasks/` bind-mounted for run outputs/uploads; GPU on the
  comfyui service; a GPU/CUDA preflight with a clear message; a node-availability smoke test;
  a **container-side setup/assessment command** (reusing the modular-installer's hardware detect
  + resolver readiness + missing-model report + VRAM→quant recommendation) that runs against the
  mounted models and detected GPU — **minus** the env-setup steps (pip/npm/node/workflow-copy)
  which the image now owns; best-effort download of only the models that **already** carry a
  `source_url`.
- **Out (deferred):** Casting / CosyVoice TTS (separate heavy env — later). LLM dialogue
  analysis stays **external** (an env var points at the user's existing OpenAI-compatible
  endpoint — LM Studio / Ollama / cloud). Baking models into images. Second motion-only
  ComfyUI instance (single comfyui service hosts all nodes). **Filling in model `source_url`s
  + gated/consent (HF-token) download handling is its own follow-up spec** (it enhances the
  shared `modules.py` model registry and benefits the native installer too); the Docker
  assessment command inherits it automatically once it lands.

## Decisions (from brainstorming)

1. **Audience:** distribution to users — one-command deploy that does not touch their existing
   ComfyUI; Windows WSL2+GPU friction is accepted.
2. **Models:** bind-mount the host's existing `models/` directory into the comfyui container
   (files only → no dependency pollution; small image; no re-download).
3. **Scope:** camera-lab + ComfyUI (all image/video nodes for current workflows) + mounted
   models. No Casting/TTS. LLM external.
4. **Structure:** two-service compose (comfyui = GPU; camera-lab = CPU).
5. **Node set:** bundle every custom node used by any current `workflows/app/*.json`.
6. **Assessment/provisioning:** the installer's assessment half survives as a container-side
   `check_setup` command + live `/api/config` UI readiness; v1 downloads only models that already
   have a `source_url`. Filling URLs + gated/consent download is a **separate follow-up spec**.

## Architecture

Two services on one compose network:

```
 host browser ──▶ camera-lab (CPU, python:slim + Pillow)   published port e.g. 8000
                        │  COMFYUI_URL=http://comfyui:8188
                        ▼
                  comfyui (GPU, pinned ComfyUI + pinned custom nodes)   :8188 (internal)
                        │  reads/writes
                        ▼
     host models/ (bind, ro)      host tasks/ (bind, rw, shared with camera-lab)
```

- `camera-lab` reads workflows from its **own** repo copy (`workflows/app`), converts to API,
  and POSTs prompts to `comfyui`. It never needs the workflows copied into ComfyUI, and it
  needs no GPU.
- `comfyui` is a **fresh, isolated** ComfyUI instance — the user's native ComfyUI is untouched.
- **Shared ComfyUI input directory (required, not just HTTP):** camera-lab stages uploaded and
  reference media by writing files **directly into ComfyUI's `input/` directory** on the
  filesystem (`shutil.copy2(src, COMFY_INPUT/…)`), then references them by name in the prompt.
  So the two services must **share ComfyUI's `input/` directory via a bind/volume** — camera-lab
  writes, comfyui reads. camera-lab must know that path (its `COMFY_INPUT` must resolve to the
  same mounted location the comfyui container reads from). How camera-lab retrieves the
  **generated** media (HTTP `/view` vs reading the shared `output/` dir) must be confirmed during
  implementation and the volume mapping matched to it.

### Components / files (all new, under `docker/` + repo root)

1. `docker/comfyui.Dockerfile`
   - `FROM` a CUDA runtime base (e.g. `nvidia/cuda:*-runtime-ubuntu22.04`) + Python.
   - Clone ComfyUI at a **pinned commit**; `pip install` its requirements.
   - Install each pinned custom node (repo + commit from `docker/nodes.lock`) into
     `custom_nodes/` and install each node's `requirements.txt`.
   - Entrypoint: `python main.py --listen 0.0.0.0 --port 8188` (+ any base flags).

2. `docker/camera-lab.Dockerfile`
   - `FROM python:3.12-slim`; copy the repo; `pip install -r requirements.txt` (Pillow).
   - Entrypoint: `python server/camera_lab_server.py --host 0.0.0.0 --port 8000`
     (the server already accepts `--host`/`--port`; default host is already `0.0.0.0`).

3. `docker-compose.yml` (repo root)
   - `comfyui` service: build `docker/comfyui.Dockerfile`; GPU via
     `deploy.resources.reservations.devices` (driver `nvidia`, `count: all`, capability `gpu`);
     volumes: `${MODELS_DIR}:/opt/ComfyUI/models` (host models, ro), a shared `comfy_input`
     volume at `/opt/ComfyUI/input`, and a shared `comfy_output` volume at `/opt/ComfyUI/output`;
     a healthcheck hitting `/system_stats` or `/object_info`.
   - `camera-lab` service: build `docker/camera-lab.Dockerfile`; `depends_on: comfyui`
     (condition: service_healthy); env `COMFYUI_URL=http://comfyui:8188`,
     `LLM_URL`/`LLM_MODEL`/`LLM_API_KEY` (external, optional); volumes: the **same**
     `comfy_input` volume mounted where camera-lab's `COMFY_INPUT` resolves (so its staged files
     land where comfyui reads), the shared `comfy_output` volume, and `./tasks:/app/tasks` for
     run records; publish `${CAMERA_LAB_PORT:-8000}:8000`.
   - A `.env` (compose) supplies `MODELS_DIR`, `CAMERA_LAB_PORT`, and the LLM vars.

4. `docker/nodes.lock` — the definitive `repo_url @ commit` list of custom nodes (see below).

5. `.dockerignore` (exclude `tasks/`, `.git/`, node_modules, `.superpowers/`, models).

6. `docker/README.md` — prerequisites (GPU toolkit), `MODELS_DIR` config, `docker compose up`,
   troubleshooting (GPU not visible).

### Node set (the real work + risk)

Derive it deterministically, do not hand-guess. Start from the repo's existing
`dependency-manifest.json` (referenced by `workflows/README.md` / `AGENTS.md` as the source of
required models + custom nodes) and reconcile it with an actual scan:

1. Collect every `class_type`/`type` across `workflows/app/*.json` (94 distinct today, incl. the
   `*.ui.json` Bernini/VACE workflows).
2. Drop subgraph UUID ids and built-in ComfyUI core nodes.
3. Map each remaining custom node class → its custom-node repo, cross-checked against
   `dependency-manifest.json` and the reference install `ComfyUI-scail/custom_nodes/`:
   `ComfyUI-LTXVideo`, `WhatDreamsCost-ComfyUI`, `ComfyUI-GGUF`, `comfyui-kjnodes`,
   `ComfyUI-VideoHelperSuite`, `ComfyUI-HY-Motion1`, `ComfyUI-mesh2motion`, the Bernini/WAN
   provider (verify which repo exposes `BerniniConditioning`), `rgthree-comfy`,
   `comfyui_essentials`, and Camera Lab's `workflow_compat_nodes`.
4. Pin each to a specific commit in `docker/nodes.lock` so node class names match what Camera
   Lab's builders expect. **This pinning is where "works today, breaks tomorrow" risk lives.**

### Setup & assessment in the Docker world

The old `install_camera_lab.py` did two jobs; Docker splits them:

- **Environment/deps/nodes/workflows** → fully replaced by the images. No pip/npm/node-install/
  workflow-copy for the user.
- **Hardware/VRAM/storage assessment + model provisioning** → still needed, and relocated to a
  **container-side assessment command**, e.g. `docker compose run --rm camera-lab python
  scripts/check_setup.py`. It reuses the existing modular-installer pieces (`hardware.py`
  detect, `resolver.py` readiness / `_profile_eligible`, `missing_downloadable_models`, the
  VRAM→GGUF quant ladder) but **skips** the pip/npm/node/workflow-copy steps. Running inside the
  comfyui-adjacent context, it sees the mounted `models/` and the container's GPU, and reports:
  which modules are ready, which required models are missing (and where to drop them), and the
  recommended quant for the detected VRAM.
- **Live readiness in the UI:** once the stack is up, `/api/config` `modules` already surfaces
  per-module readiness in the frontend, so the user also sees status without a separate command.
- **Model download in v1:** best-effort only — the assessment command downloads models that
  already carry a `source_url` into the mounted volume; everything else is reported as "provide
  manually". Comprehensive URL coverage + gated/consent (HF-token) download is the separate
  follow-up spec noted in Scope.

### Data flow

`docker compose up` → comfyui boots (loads nodes, becomes healthy) → camera-lab boots, waits
for comfyui health → user opens `http://localhost:${CAMERA_LAB_PORT}` → generates → camera-lab
patches the workflow and POSTs to `comfyui:8188` → ComfyUI runs on GPU using the mounted
models → outputs land in the shared `comfy_output` volume → camera-lab serves them back.

## Error handling / edge cases

- **GPU not visible** (missing nvidia-container-toolkit / WSL2 / driver): a preflight in the
  comfyui entrypoint runs a quick CUDA check (e.g. `nvidia-smi` or a torch `cuda.is_available()`
  probe) and, if it fails, prints a clear remediation message and exits non-zero, so the failure
  is diagnosable instead of a cryptic CUDA stack trace.
- **Models dir not set / empty:** generations fail on missing files; Camera Lab's existing
  resolver / `/api/config` `modules` readiness already reports which models are missing.
- **Node drift:** avoided by pinning ComfyUI + every custom node to a commit; the smoke test
  catches regressions.
- **Windows bind-mount quirks:** `MODELS_DIR` documented with a Windows path example; large
  bind mounts over WSL2 are read-mostly so performance is acceptable.
- **Port conflicts:** `CAMERA_LAB_PORT` configurable; comfyui port stays internal.

## Testing

- **Build:** both images build (CI or local).
- **Node-availability smoke test (key):** with the stack up, query comfyui `/object_info` and
  assert every node class in Camera Lab's module `required_nodes` (and every custom class used
  by `workflows/app/*.json`) is present. This reuses the installer's `required_nodes` data and
  ties the Docker image to the installer's contract — it catches node-version drift before a
  user hits it.
- **Wiring test:** `docker compose up`; poll camera-lab `/api/config`; assert `comfy.ok` is true
  (camera-lab reached the comfyui service over the network).
- **Assessment command:** `docker compose run --rm camera-lab python scripts/check_setup.py`
  runs to completion inside the container, detects the GPU, and reports module readiness +
  missing models against the mounted `models/` without error.
- **Manual GPU smoke:** one real generation (needs GPU + a mounted model) — manual / gated,
  not in automated CI.

## Risks / notes

- GPU-in-Docker host prerequisites (nvidia-container-toolkit on Linux; Docker Desktop + WSL2 +
  driver on Windows) are a one-time manual step no Docker design can remove; the preflight makes
  failures legible.
- Custom-node pinning against a specific ComfyUI commit is fragile to upstream churn; `nodes.lock`
  + the object_info smoke test are the guardrails.
- Image size: the comfyui image (CUDA + torch + nodes) is multi-GB; models stay on the host, so
  the image itself is bounded.
