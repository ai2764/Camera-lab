# Developer Guide

## Repository Layout

- `server/`: Python backend, local HTTP server, and ComfyUI bridge.
- `frontend/`: static browser UI served by the Python backend.
- `scripts/`: cross-platform Python helpers plus Windows PowerShell wrappers.
- `scripts/camera_lab_setup/`: modular setup, hardware detection, model/module resolver.
- `workflows/app/`: checked-in ComfyUI workflows used by Camera Lab.
- `workflows/experimental/`: optional research workflow references.
- `docs/`: screenshots, notes, and wiki source pages.
- `tests/`: Python unit tests and Playwright smoke tests.
- `tasks/`: local-only generated runs, uploads, logs, and scratch data.

## Local Setup For Development

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
```

Use `python3` instead of `python` where needed.

## Python Tests

```powershell
python -m pytest -p no:cacheprovider -q
```

Focused launcher tests:

```powershell
python -m pytest -p no:cacheprovider tests/test_launch.py -q
```

## Browser E2E Tests

Install Node dependencies and Chromium:

```powershell
npm install
npx playwright install chromium
```

Run:

```powershell
npm run test:e2e
```

## Runtime Data

Generated runs and uploaded files are written under:

- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`

`tasks/` is ignored by git. Do not put public docs, required workflows, or
committable test assets there.

## Commit Hygiene

Do not commit:

- `.env`
- `tasks/`
- generated videos
- uploads
- logs
- preview renders
- local ComfyUI install paths

