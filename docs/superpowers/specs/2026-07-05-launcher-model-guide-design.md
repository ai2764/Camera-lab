# Launcher Model Guide — Design

> Status: design (brainstormed 2026-07-05). Implementation plan to follow via writing-plans.
> Branch: `feature/modular-installer`.

## Goal

After the launcher's hardware assessment, print a **per-tab (per-module) model guide**: for each
module, list the models it needs, whether each is present or missing, the exact install path, and
the model's **download page** URL. This turns today's opaque "manual: <filename>" into an
actionable "get it here, put it there" list, so a user starting from little can provision the
models each workspace needs.

## Why (problem)

- Docker/native provisions the *environment* (ComfyUI + nodes) but not *models*. Most model
  profiles have no `source_url`, so the missing-model report only names files with no source or
  destination — the user has no idea where to get them or where they go.
- The user does not want an auto-downloader (HF tokens, license/consent, brittle direct links).
  A **download-page guide grouped by tab** is enough: point the user at each model's page (where
  they accept any license and download), and tell them the exact install path.

## Scope (v1)

- **In:** a `page_url` field on `ModelRef`; researched + verified **download-page** URLs for the
  required models of all five modules (camera, director, edit, motion, casting); a
  `print_model_guide(...)` step in `scripts/launch.py` that runs after `print_assessment`, groups
  by module, and prints each model's present/missing status, install path, and download page.
- **Out (deferred / untouched):** the existing auto-downloader (`maybe_download_models` et al.) is
  **not modified**. No HF-token / gated / consent / license mechanics. No app-UI surface (launcher
  CLI only). No changes to which quant profile is chosen.

## Decisions (from brainstorming)

1. Surface = **in the launcher, right after the hardware assessment** (not the app UI, not a
   separate doc).
2. Content = **download pages** (HF repo/model pages), **grouped by tab/module**, with the install
   path per model.
3. Cover **all five modules** (a download page is findable even where a clean non-gated direct link
   is not).
4. Store the page URL as a **new `page_url` field** on `ModelRef` (may be derived from an HF repo
   id where one exists); the existing `source_url` (auto-download direct link) is left as-is.
5. The **auto-downloader is not touched** at all.

## Global Constraints

- **All product text is English only — no Chinese** anywhere in code, comments, string literals,
  the guide output, or committed data.
- Do not modify the existing auto-download path (`missing_downloadable_models`,
  `maybe_download_models`, `download_file`).
- Reuse the launcher's existing `assess()` output; the guide reads module + model data, it does not
  re-probe ComfyUI.

## Architecture

Two pieces:

1. **Model registry (`scripts/camera_lab_setup/modules.py`)**
   - Add `page_url: str = ""` to the `ModelRef` dataclass (frozen; keep `folder`, `name`,
     `source_url`).
   - Fill `page_url` for the required models of every module, from verified research. Where a model
     comes from an HF repo (`_hf(repo, path)`), the page is `https://huggingface.co/<repo>`; a small
     helper `_hf_page(repo)` returns that so direct link and page stay in sync. Models with **no
     public source** get `page_url=""` and are reported as "no public source — obtain manually".

2. **Launcher guide (`scripts/launch.py`)**
   - `model_guide_rows(assessment, modules=MODULES) -> list[dict]` (pure over its inputs): for each
     module in `assessment["modules"]`, resolve the module object and its **assessed** profile
     (`row["profile"]`, falling back to the module's first `model_profiles` entry when the profile
     id is `None`); for each required model of that profile produce
     `{module, name, folder, install_path, page_url, present}` where
     `install_path = f"models/{folder}/{name}"` and `present` is `None` when
     `assessment["has_comfy"]` is False, else `name not in row["missing"]`. Using the assessed
     profile keeps the rows consistent with the `missing` list that same profile produced.
   - `print_model_guide(assessment) -> None`: group `model_guide_rows` by module and print, e.g.:

     ```
     Model guide (download the missing files and place them at the listed path):
       camera:
         [missing] models/checkpoints/ltx-2.3-22b-dev-fp8.safetensors
                   https://huggingface.co/Lightricks/LTX-Video
         [ok]      models/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors
       director:
         ...
     ```

   - Call `print_model_guide(assessment)` in `main()` immediately after `print_assessment(...)`
     (before the `--assess-only` return, so `--assess-only` shows the guide too).

### Data flow

`main()` → `detect_hardware` + `probe_comfy` → `assess` → `print_assessment` →
**`print_model_guide`** → (unless `--assess-only`) `choose_mode` → `launch`.

The guide needs per-model presence. `assess()` currently reports per-module `missing` (a list of
model names). The guide reuses that: a model is "missing" if its `name` is in the module's
`missing` list, else "ok". So `print_model_guide` consumes the existing `assessment` plus
`model_guide_rows(MODULES)` — no new ComfyUI calls.

## Error handling / edge cases

- Model with `page_url == ""` → print `no public source — obtain manually` instead of a URL.
- No ComfyUI reachable (`has_comfy == False`, no visibility) → presence is unknown; print every
  model as `[needed]` (not `[ok]`/`[missing]`) with its path + page, since we cannot confirm
  presence.
- A module whose ready profile has zero required models (e.g. `casting-local`) → print
  `no model files required`.

## Testing

- **Pure `model_guide_rows(assessment)`** (unit): fed a fake assessment, every required model of
  the assessed profile yields a row with a correct `install_path` of the form
  `models/<folder>/<name>`; rows are grouped/ordered by module; a model with a known HF repo has the
  expected `https://huggingface.co/<repo>` page; `present` is `None` when `has_comfy=False`, else
  `name not in row["missing"]`.
- **Presence formatting** (unit): `print_model_guide` marks `present=False` rows `[missing]`,
  `present=True` `[ok]`, and `present=None` `[needed]`.
- **`page_url` coverage** (unit): a test asserts each camera + director required model has a
  non-empty `page_url` (the priority modules must be fully guided); other modules may still have
  gaps recorded as "no public source".

## Risks / notes

- Research accuracy: the plan must verify each `page_url` actually hosts that file (HF pages move /
  get gated); the coverage test guards camera+director, but edit/motion/casting pages need a manual
  verification pass during implementation.
- `ModelRef` is frozen and widely constructed positionally; adding `page_url` as a trailing keyword
  field with a default keeps every existing `ModelRef(folder, name, source_url)` call valid.
