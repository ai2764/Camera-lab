# Camera Lab

Camera Lab is a local browser workspace for building ComfyUI-powered AI video
shots. It combines prompt-driven video generation, Director-style timeline
assembly, WAN/Bernini editing, Motion tools, and Casting voice preparation in
one web UI.

It runs as a lightweight Python HTTP server, serves a static frontend, and
submits patched workflow prompts to a local or Dockerized ComfyUI instance.

![Camera Lab ComfyUI video workbench](docs/images/camera-lab-hero.png)

## Start Here

Use the launcher:

```powershell
python scripts/launch.py
```

The launcher checks your GPU, VRAM, ComfyUI connection, module readiness, and
model visibility. It does **not** download models, install ComfyUI, or modify
your existing ComfyUI installation.

Safe commands:

```powershell
python scripts/launch.py --assess-only
python scripts/launch.py --dry-run
```

- `--assess-only` prints the hardware/module/model report.
- `--dry-run` prints the commands it would run without starting services.

## Which Install Path Should I Choose?

| Your situation | Recommended mode |
|---|---|
| You already have ComfyUI and want the simplest setup | `no-docker` |
| You already have ComfyUI but want Camera Lab isolated in Docker | `cam-lab-only-docker` |
| You do not have ComfyUI but want Camera Lab native | `comfy-only-docker` |
| You do not have ComfyUI and want everything isolated | `full-docker` |

Beginner rule of thumb:

- Already use ComfyUI? Start with `no-docker`.
- Do not have ComfyUI? Start with `full-docker`.
- New to Docker? Install ComfyUI normally first, then use `no-docker`.

Full setup instructions are in the [Installation Guide](docs/wiki/Installation-Guide.md).

## Windows Without Python

If Python is not installed, start from the repository root with:

```powershell
.\install_camera_lab.ps1
```

This bootstrap uses `winget` to install Python 3.12, then runs the Camera Lab
installer.

## Quick Commands

Assess your machine:

```powershell
python scripts/launch.py --assess-only
```

Preview a mode:

```powershell
python scripts/launch.py --dry-run --mode no-docker
python scripts/launch.py --dry-run --mode full-docker
```

Start with an existing native ComfyUI:

```powershell
python scripts/launch.py --mode no-docker
```

Start the full Docker stack:

```powershell
python scripts/launch.py --mode full-docker
```

Stop native Camera Lab:

```powershell
python scripts/stop_camera_lab.py
```

Stop Docker modes:

```powershell
docker compose --env-file docker/compose.env down
docker compose -f docker-compose.comfy-only.yml --env-file docker/compose.comfy-only.env down
docker compose -f docker-compose.camera-lab-only.yml --env-file docker/compose.camera-lab-only.env down
```

## Workspaces

- **Camera Lab**: standard LTX image/video generation workflows.
- **Director**: timeline assembly, audio cues, IC references, and retake workflows.
- **Edit**: WAN2.2 Bernini video editing and WAN VACE Inpaint.
- **Motion**: Text to Motion, SCAIL2, and browser-recorded 3D Motion guides.
- **Casting**: script lines, voice library, optional LLM analysis, and optional CosyVoice TTS.

More detail: [Workspaces](docs/wiki/Workspaces.md).

## Documentation

- [Installation Guide](docs/wiki/Installation-Guide.md)
- [Architecture](docs/wiki/Architecture.md)
- [Workspaces](docs/wiki/Workspaces.md)
- [Models and Workflows](docs/wiki/Models-and-Workflows.md)
- [Director Reference](docs/wiki/Director-Reference.md)
- [Developer Guide](docs/wiki/Developer-Guide.md)

These files are stored in `docs/wiki/` so they can be copied directly into the
GitHub Wiki after Wiki is enabled for the repository.

## Development

Repo-side setup:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
```

Python tests:

```powershell
python -m pytest -p no:cacheprovider -q
```

Browser E2E tests:

```powershell
npm install
npx playwright install chromium
npm run test:e2e
```

More detail: [Developer Guide](docs/wiki/Developer-Guide.md).

## Repository Layout

- `server/`: Python backend, local HTTP server, and ComfyUI bridge.
- `frontend/`: static browser UI.
- `scripts/`: setup, launch, workflow install, and utility scripts.
- `scripts/camera_lab_setup/`: hardware detection and module/model resolver.
- `workflows/app/`: checked-in workflows used by Camera Lab.
- `workflows/experimental/`: optional research workflow references.
- `docs/wiki/`: long-form documentation intended for GitHub Wiki.
- `tests/`: Python unit tests and Playwright smoke tests.
- `tasks/`: local-only generated runs, uploads, logs, and scratch data.

`tasks/` is ignored by git. Do not put public docs, required workflows, or
committable test assets there.
