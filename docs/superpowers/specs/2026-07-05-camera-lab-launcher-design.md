# Camera Lab Launcher — Design

> Status: design (brainstormed 2026-07-05). Implementation plan to follow via writing-plans.
> Branch: `feature/modular-installer`.

## Goal

A single host-side launcher that runs **before / decoupled from Docker**: it detects the real
hardware (on the host, where the GPU is visible), gives a feasibility + model recommendation,
asks whether the user already has a working ComfyUI and whether they want Docker, then **actually
starts** the deployment mode they pick. It fixes the "hardware assessment is blind inside the
CPU camera-lab container" problem by doing the assessment natively on the host.

## Why (problem)

- `detect_hardware` reads the GPU/VRAM from local `nvidia-smi`. Inside the CPU-only camera-lab
  container it returns `gpu_name=None, vram_gb=None` ("GPU VRAM could not be detected"), so any
  VRAM-based feasibility / quant recommendation is dead there.
- camera-lab itself is trivial to install (`requirements.txt` = `Pillow`, static frontend, no
  build). The only hard part is **ComfyUI** (nodes + models + config). So deployment choice really
  pivots on **"who provides ComfyUI"** — and the launcher should make that choice for the user.

## Scope (v1)

- **In:** a host-native launcher (`scripts/launch.py`) that (1) detects hardware, (2) reports
  per-module feasibility + recommended profile/quant + what an existing ComfyUI is missing,
  (3) asks "do you already have ComfyUI?" and "do you want Docker?", (4) presents the 4 modes
  with a recommended default, (5) starts the chosen mode. Plus one new compose file
  (`docker-compose.comfy-only.yml`) — the only missing piece.
- **Out (deferred):** model **downloading** (recommend only — download is the separate
  model-URL/consent follow-up spec). Casting/CosyVoice. Any GUI (this is a CLI).

## Decisions (from brainstorming)

1. Keep **all 4 modes**: `no-docker`, `full-docker` (comfyui + camera-lab), `comfy-only-docker`
   (comfyui container + native camera-lab), `cam-lab-only-docker` (native/existing comfyui +
   camera-lab container).
2. Launcher **orchestrates**: assess → recommend → ask → **actually launch** the chosen mode.
3. Model handling is **recommend-only**, no download.
4. Structure = a **standalone interactive Python CLI** `scripts/launch.py` that reuses the
   existing installer machinery and shells out to `docker compose` / `start_camera_lab.py`.

## Architecture

`scripts/launch.py` runs natively on the host (real GPU visible) and drives this flow:

```
launch.py
 1. detect_hardware(repo_root, comfy_root)      -> GPU / VRAM / OS (real, e.g. 24 GiB)
 2. probe existing ComfyUI (8188, 8000, env)    -> reachable? -> /object_info -> visibility
 3. resolve_modules(MODULES, hardware, vis)     -> per-module: ready / profile / missing
    + _profile_vram(profile)                    -> per-module: feasible on this VRAM? which quant
    => print an assessment table + recommendations
 4. ask: "Do you already have a working ComfyUI?"  (auto-suggest from step 2 probe)
 5. ask: "Run with Docker?"  -> present the 4 modes, with a RECOMMENDED default from 3+4
 6. launch the chosen mode (below)
```

### Components / files

1. `scripts/launch.py` — **create**: the CLI. Sections:
   - `assess()` — calls `detect_hardware` + probes ComfyUI + `resolve_modules`; returns a struct
     with hardware, comfy-reachable flag, and per-module `{ready, profile, feasible, recommended_quant, missing}`.
   - `print_assessment(assessment)` — the human-readable feasibility + model-recommendation report.
   - `choose_mode(assessment) -> mode` — interactive prompts (have comfy? want docker?) with a
     recommended default derived from the assessment; supports non-interactive `--mode <id>` and `--yes`.
   - `launch(mode, ...)` — maps mode → command and runs it (subprocess), inheriting stdio.
   - Pure helpers (unit-testable): `recommended_mode(has_comfy: bool, want_docker: bool) -> str`
     and `feasibility_for(profile, vram_gb) -> str` and `mode_command(mode, env_file) -> list[str]`.

2. `docker-compose.comfy-only.yml` — **create**: a single `comfyui` service (same image/build as
   the full stack) that **publishes 8188 to the host** and bind-mounts a host ComfyUI data dir for
   `input`/`output` (so a native camera-lab can write staged media where the container reads).
   Models mounted from `MODELS_DIR` like the full stack. No camera-lab service.

3. `docker/compose.comfy-only.env.example` — **create**: `MODELS_DIR`, the host input/output data
   dir, published comfy port.

### Mode → launch mechanics

| mode | who provides comfy | launch action |
|---|---|---|
| `no-docker` | user's native comfy (must be running) | `python scripts/start_camera_lab.py --open` (native camera-lab → existing comfy) |
| `full-docker` | comfyui container | `docker compose -f docker-compose.yml --env-file docker/compose.env up -d --build` |
| `comfy-only-docker` | comfyui container (8188 published) | `docker compose -f docker-compose.comfy-only.yml … up -d --build`, then `python scripts/start_camera_lab.py --open` with `COMFYUI_URL=http://127.0.0.1:8188` and `COMFYUI_ROOT` = the mounted data dir |
| `cam-lab-only-docker` | user's native/existing comfy (on 0.0.0.0) | `docker compose -f docker-compose.camera-lab-only.yml … up -d --build` |

### Data flow / decision logic

- **ComfyUI probe (step 2):** try `COMFYUI_URL` from env, then `http://127.0.0.1:8188` and
  `:8000`; a successful `/system_stats` means "you already have a working ComfyUI"; then pull
  `/object_info` to build `visibility` so `resolve_modules` reports real missing-model lists.
- **Feasibility (step 3):** for each module, `feasibility_for(profile, vram_gb)` compares the
  detected VRAM against `_profile_vram(profile)` / the profile's quant ladder → "runs / recommend
  quant X / won't fit". If VRAM is unknown, say so instead of guessing.
- **Recommended mode (step 5):** `recommended_mode(has_comfy, want_docker)` —
  has_comfy & !want_docker → `no-docker`; has_comfy & want_docker → `cam-lab-only-docker`;
  !has_comfy & want_docker → `full-docker`; !has_comfy & !want_docker → advise "install ComfyUI
  or choose a docker mode".

## Error handling / edge cases

- GPU not detected → print the `detect_hardware` warning and continue (feasibility shows
  "VRAM unknown"); do not block.
- A docker mode chosen but the Docker daemon is down → detect via `docker info`, print a clear
  "start Docker Desktop" message, exit non-zero.
- `no-docker` / `cam-lab-only-docker` chosen but no ComfyUI was reachable → warn that comfy must
  be started first (and for `cam-lab-only`, that it must listen on `0.0.0.0`).
- Non-interactive use: `--mode`, `--yes`, `--assess-only` flags so it can run unattended / in CI.

## Testing

- **Pure helpers** (unit tests, no host/docker needed): `recommended_mode`, `feasibility_for`
  (VRAM thresholds incl. the unknown-VRAM case), `mode_command` (each mode → exact argv).
- **Assessment** against a fake `/object_info` + a stub hardware struct → correct per-module
  ready/feasible/missing.
- **Launch** is host-manual (actually starting containers/processes is not automated in CI).

## Risks / notes

- The launcher shells out; it must surface child stdout/stderr and exit codes faithfully.
- `comfy-only-docker` reintroduces the native-camera-lab ↔ container-comfy filesystem coupling
  (staged input): the container's `input`/`output` must bind-mount the same host dir the native
  camera-lab uses as `COMFYUI_ROOT`. The env example documents this.
- The Windows backslash-subfolder output fix already landed; native camera-lab + container comfy
  (comfy on Linux) reports `/`, so that path is clean.
- The docker-comfy modes (`full-docker`, `comfy-only-docker`) inherit the existing compose model
  mounting (a single `MODELS_DIR` bind). Users whose models span multiple roots (e.g. an
  `extra_model_paths.yaml` across several drives) still need those handled separately — the
  launcher only recommends and launches; extending the compose to multi-root is out of v1 scope.
