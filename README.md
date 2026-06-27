# Camera Lab

Camera Lab is a local web workspace for building ComfyUI-powered AI video shots. It combines prompt-driven video generation, Director-style timeline assembly, and Casting voice preparation in one browser UI.

It runs as a lightweight Python HTTP server, serves a static frontend, and submits patched workflow prompts to a local ComfyUI instance.

![Camera Lab ComfyUI video workbench](docs/images/camera-lab-hero.png)

## System Architecture

```mermaid
flowchart TB
  USER["User in browser"]
  UI["Static frontend<br/>Camera Lab / Director / Edit / Motion / Casting"]
  SERVER["Python HTTP server<br/>media staging, validation, prompt patching, polling"]
  RUNS["Local run state<br/>tasks/, uploads, outputs, history"]

  subgraph Workflows["Workflow layer"]
    LTX["LTX shot and Director workflows"]
    WAN["WAN Bernini and VACE Inpaint workflows"]
    MOTION["HY-Motion and SCAIL2 workflows"]
    CAST["Casting analysis and TTS jobs"]
  end

  subgraph Comfy["Local generation services"]
    COMFY_MAIN["ComfyUI main instance<br/>COMFYUI_URL"]
    COMFY_MOTION["Optional motion ComfyUI<br/>COMFYUI_MOTION_URL"]
  end

  subgraph Models["Model assets outside this repo"]
    LTX_MODEL["LTX 2.3 model stack"]
    WAN_MODEL["WAN2.2 / VACE / Bernini model stack"]
    SCAIL_MODEL["HY-Motion / SCAIL2 model stack"]
    VOICE_MODEL["Optional LLM + CosyVoice"]
  end

  OUT["Generated media<br/>videos, images, audio, metadata"]

  USER --> UI --> SERVER
  SERVER --> RUNS
  SERVER --> Workflows
  LTX --> COMFY_MAIN --> LTX_MODEL
  WAN --> COMFY_MAIN --> WAN_MODEL
  MOTION --> COMFY_MOTION --> SCAIL_MODEL
  CAST --> VOICE_MODEL
  LTX_MODEL --> OUT
  WAN_MODEL --> OUT
  SCAIL_MODEL --> OUT
  VOICE_MODEL --> OUT
  OUT --> RUNS
  RUNS --> UI
```

## What It Does

- **Camera Lab** queues image-to-video and multi-image workflow runs with reusable camera move presets, prompts, seeds, reference images, and result history.
- **Director** assembles shot timelines, audio cues, reference images, and workflow settings for longer structured video runs.
- **Edit** groups WAN2.2 Bernini video editing modes and WAN VACE Inpaint into one workspace. Bernini supports T2V, I2V, V2V, MV2V, VI2V, VRC2V, R2V, RV2V, and ADS2V modes; Inpaint lets you upload a source video, paint a replacement mask, and optionally provide a reference image.
- **Casting** turns scripts into dialogue lines, assigns character voices and emotions, generates voice clips with CosyVoice when available, and keeps the voice library usable even when optional analysis or TTS services are offline.
- **Motion** drives the SCAIL-2 video model to animate a reference character from a guide pose video. It has three tools: **Text to Motion** (HY-Motion turns a text prompt into a pose video), **SCAIL2** (renders a pose video onto a reference character), and **3D Motion** (poses a rigged 3D character in the browser, then feeds that as the guide).

## Tab Architecture

Legend used in the tab diagrams:

- `[UI]`: browser controls in `frontend/`
- `[API]`: request handling and prompt patching in `server/camera_lab_server.py`
- `[WF]`: bundled workflow JSON or server-side workflow builder
- `[MODEL]`: local ComfyUI model files and custom nodes
- `[OUT]`: generated run files and history under `tasks/`

### Camera Lab Tab

**High-level overview:**

```mermaid
flowchart LR
  UI["[UI] Camera Lab tab<br/>prompt, seed, size, source images, camera move"]
  API["[API] collectPayload + run_batch_worker"]
  WF1["[WF] LTX I2V / IA2V JSON workflows"]
  WF2["[WF] Built-in FLF / FML builders"]
  MODEL["[MODEL] LTX 2.3 checkpoint<br/>Gemma text encoder<br/>distilled LoRA<br/>TTP Toolset"]
  OUT["[OUT] result video/image<br/>contact sheet<br/>history card"]

  UI --> API
  API --> WF1
  API --> WF2
  WF1 --> MODEL
  WF2 --> MODEL
  MODEL --> OUT
```

**High-level description:** Camera Lab is the core shot-generation workspace for creating short AI video clips from prompts, image references, camera moves, and reusable LTX workflow presets. The browser collects prompt, seed, frame size, duration, camera move, and source images, then the Python server validates media, patches the selected LTX workflow or built-in workflow builder, submits it to ComfyUI, and records generated media back into run history.

### Director Tab

**High-level overview:**

```mermaid
flowchart LR
  UI["[UI] Director tab<br/>timeline segments, audio cues, reference images"]
  API["[API] build_ltx_director_reference_api"]
  WF["[WF] ltx_director_reference_mvp.json"]
  PATCH["[API] timeline patching<br/>global reference injection<br/>audio segment injection"]
  MODEL["[MODEL] LTX 2.3 stack<br/>LTXDirector / LTXVAddGuideMulti<br/>Gemma encoder"]
  OUT["[OUT] structured video run<br/>timeline metadata<br/>history card"]

  UI --> API --> WF --> PATCH --> MODEL --> OUT
```

**High-level description:** Director is the structured timeline workspace for assembling longer videos from ordered segments, global references, local references, prompts, and audio cues. The UI builds a timeline payload, while the backend converts that payload into `LTXDirector` inputs, injects reference guides and audio data when needed, submits the patched Director workflow to ComfyUI, and stores the resulting video with timeline metadata for reuse.

### Edit Tab

**High-level overview:**

```mermaid
flowchart TB
  UI["[UI] Edit tab<br/>mode bar + prompt + inputs"]
  MENU["[UI] result card Edit menu<br/>send video output into edit inputs"]
  CLIP["[UI] shared clip editor<br/>trim source/reference videos"]
  API["[API] Bernini/Inpaint media validation<br/>workflow patching<br/>split/merge and preserve audio"]

  subgraph Bernini["Bernini workflows"]
    BMODES["[UI] T2V, I2V, V2V, MV2V, VI2V,<br/>VRC2V, R2V, RV2V, ADS2V"]
    BWF["[WF] workflows/app/wan22_bernini_*.ui.json"]
    BMODEL["[MODEL] Wan22 Bernini HIGH/LOW<br/>WAN2.2 LightX2V LoRAs<br/>UMT5 XXL<br/>Wan 2.1 VAE"]
    BMODES --> BWF --> BMODEL
  end

  subgraph Inpaint["Inpaint workflow"]
    IINPUT["[UI] source video + painted mask<br/>optional reference image"]
    IWF["[WF] workflows/app/wan_vace_inpainting.ui.json"]
    IMODEL["[MODEL] Wan2.1 VACE 14B<br/>UMT5 XXL<br/>Wan 2.1 VAE<br/>SAM3 mask model"]
    IINPUT --> IWF --> IMODEL
  end

  OUT["[OUT] edited video<br/>history scoped to selected edit mode"]

  MENU --> UI
  CLIP --> UI
  UI --> API
  API --> Bernini
  API --> Inpaint
  BMODEL --> OUT
  IMODEL --> OUT
```

**High-level description:** Edit is the post-generation editing workspace for changing existing images or videos through Bernini modes and masked VACE inpainting. The UI routes users into Bernini or Inpaint modes, gathers source media, reference media, masks, prompts, split settings, and trim data, then the backend stages those assets, patches the corresponding WAN workflow, optionally preserves audio or merges split RV2V segments, and saves edited results into scoped history cards.

### Motion Tab

**High-level overview:**

```mermaid
flowchart TB
  UI["[UI] Motion tab<br/>Text to Motion / SCAIL2 / 3D Motion"]
  API["[API] motion endpoints<br/>guide upload, final render, polling"]
  OUT["[OUT] guide videos<br/>SCAIL2 final videos<br/>typed Motion history"]

  subgraph TextMotion["Text to Motion"]
    TUI["[UI] motion prompt + duration + seed"]
    TWF["[WF] HY-Motion guide workflow"]
    TMODEL["[MODEL] HY-Motion model stack"]
    GUIDE["[OUT] pose guide video"]
    TUI --> TWF --> TMODEL --> GUIDE
  end

  subgraph Scail["SCAIL2"]
    SUI["[UI] guide video + reference image<br/>prompt, seed, size, pose strength<br/>Keep background mask"]
    SWF["[WF] workflows/app/scail2_video.api.json"]
    SMODEL["[MODEL] wan2.1_14B_SCAIL_2<br/>LightX2V I2V LoRA<br/>CLIP Vision H<br/>UMT5 XXL<br/>Wan 2.1 VAE<br/>SAM3 when mask enabled"]
    SUI --> SWF --> SMODEL
  end

  subgraph ThreeD["3D Motion"]
    D3UI["[UI] browser 3D stage<br/>actions, camera presets, recording"]
    D3OUT["[OUT] recorded_3d.mp4"]
    D3UI --> D3OUT
  end

  UI --> API
  API --> TextMotion
  API --> Scail
  API --> ThreeD
  GUIDE --> SUI
  D3OUT --> SUI
  SMODEL --> OUT
```

**High-level description:** Motion is the character-motion workspace for turning text, uploaded guide videos, or browser-recorded 3D motion into SCAIL2 character animation. Text to Motion produces pose guide videos, 3D Motion records browser-generated guide clips, and SCAIL2 combines a guide video with a reference character image; the backend patches motion workflows, handles reference masks and pose masks, polls the motion ComfyUI endpoint, and stores guide/final videos by motion subtype.

### Casting Tab

**High-level overview:**

```mermaid
flowchart LR
  UI["[UI] Casting tab<br/>script lines, speakers, emotions, voice library"]
  API["[API] casting endpoints<br/>library, analysis, TTS jobs"]
  LLM["[MODEL] optional OpenAI-compatible LLM<br/>script analysis"]
  TTS["[MODEL] optional CosyVoice<br/>voice synthesis"]
  OUT["[OUT] voice clips<br/>tts/library<br/>line metadata"]

  UI --> API
  API --> LLM
  API --> TTS
  LLM --> UI
  TTS --> OUT
```

**High-level description:** Casting is the dialogue and voice-preparation workspace for converting scripts into speaker lines, voice assignments, emotion metadata, and generated speech clips. The UI manages script lines and voice-library state, while optional LLM analysis can structure dialogue and optional CosyVoice synthesis can render audio; the server keeps these integrations isolated so the tab remains usable when either external dependency is unavailable.

## Quick Start

For a fresh local setup, start with the module-aware installer:

```powershell
python scripts/install_camera_lab.py --all
python scripts/check_setup.py
```

On Windows, you can start from the repository root even if Python is not installed:

```powershell
.\install_camera_lab.ps1
```

If Python is not installed, this bootstrap script uses `winget` to install Python 3.12, then runs the same module-aware installer. A double-click friendly `install_camera_lab.bat` wrapper is also available.

To inspect or install only selected modules:

```powershell
python scripts/install_camera_lab.py --list-modules
python scripts/install_camera_lab.py --modules camera,director
python scripts/check_setup.py --modules director
```

Edit `.env` after the installer creates it if `COMFYUI_ROOT` is still the placeholder value. The installer evaluates local hardware, installs repo dependencies, and installs bundled workflows when `COMFYUI_ROOT` is valid. It does not install ComfyUI, models, or custom nodes.

For coding-agent compatibility, the older commands still work:

```powershell
python scripts/agent_setup.py
python scripts/install_workflows.py
python scripts/check_setup.py
```

### 1. Requirements

- Windows, macOS, or Linux
- Python 3.10 or newer
- A working local ComfyUI install

Use `python3` instead of `python` on systems where the `python` command is not available.

If you do not have ComfyUI yet, install it first:

- Comfy Desktop: <https://docs.comfy.org/installation/desktop/overview>
- Manual local install: <https://docs.comfy.org/installation/manual_install>
- Source repository: <https://github.com/comfy-org/comfyui>

Camera Lab can install its own Python and Node dependencies, but it does not install ComfyUI, ComfyUI models, or custom nodes. Without ComfyUI, you can inspect the repo and run repo-only tests, but video generation and full setup checks will fail.

Start ComfyUI first. Camera Lab expects ComfyUI to be reachable at:

```text
http://127.0.0.1:8000
```

### 2. Create Local Config

Copy the example config:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your own ComfyUI folder:

```text
COMFYUI_ROOT=<path-to-your-ComfyUI>
COMFYUI_URL=http://127.0.0.1:8000
```

The **Motion** workspace can use a separate ComfyUI instance that hosts the HY-Motion and SCAIL-2 nodes. It is optional: leave it unset to route Motion through the main `COMFYUI_URL`, or point it at a dedicated instance.

```text
COMFYUI_MOTION_URL=http://127.0.0.1:8188
COMFYUI_MOTION_ROOT=<path-to-your-ComfyUI-scail>
```

Do not commit `.env`. It is ignored by git because it is machine-specific.

### 3. Install Python Dependency

```powershell
python -m pip install -r requirements.txt
```

### 4. Install Bundled Workflows into ComfyUI

Camera Lab stores workflow files in this repo, but ComfyUI only sees workflows that are inside your local ComfyUI workflow folder.

Install bundled app workflows into:

```text
<COMFYUI_ROOT>/user/default/workflows/camera-lab/
```

Run:

```powershell
python scripts/install_workflows.py
```

To install only selected module workflows:

```powershell
python scripts/install_workflows.py --modules camera,director
```

To also install experimental Director / IC-LoRA workflows:

```powershell
python scripts/install_workflows.py --include-experimental
```

Restart or refresh ComfyUI if its workflow browser does not show the new files.

### 5. Check Setup

Run:

```powershell
python scripts/check_setup.py
```

To check only selected modules:

```powershell
python scripts/check_setup.py --modules director
```

If a check says `MISSING`, fix that item before starting Camera Lab. The most common issues are:

- `.env` was not created
- `COMFYUI_ROOT` points to the wrong folder
- ComfyUI is not running
- Required LTX models are missing
- Required custom nodes or workflow files are missing
- Bundled workflows were not installed into ComfyUI

### 6. Start Camera Lab

```bash
python scripts/start_camera_lab.py --open
```

Default URL:

```text
http://127.0.0.1:1234
```

Use another port if needed:

```bash
python scripts/start_camera_lab.py -p 9000 --open
```

### 7. Stop Camera Lab

```bash
python scripts/stop_camera_lab.py
```

Use a custom port if you started one:

```bash
python scripts/stop_camera_lab.py -p 9000
```

Windows PowerShell wrappers are also available:

```powershell
.\scripts\agent_setup.ps1
.\scripts\install_workflows.ps1
.\scripts\check_setup.ps1
.\scripts\start_camera_lab.ps1 -Open
```

## If PowerShell Blocks Scripts

Run this once for your Windows user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

You can also start the server directly:

```powershell
python server\camera_lab_server.py --port 1234
```

Then open:

```text
http://127.0.0.1:1234
```

## Casting Workspace Dependencies

The Casting workspace is optional and degrades safely. Camera Lab's server and UI can start without an LLM endpoint and without CosyVoice. When those dependencies are missing, the Casting tab still opens, shows a setup warning, and keeps manual line editing and the existing voice library UI available.

Casting has two independent dependency groups:

- **LLM dialogue analysis**: used only by the `Analyze` button to turn a script into short voice lines. It can use any OpenAI-compatible chat completions endpoint.
- **CosyVoice TTS generation**: used only by per-line and `Generate all` speech synthesis. It runs on demand in the configured CosyVoice Python environment.

Configure the LLM endpoint in `.env`:

```text
LLM_URL=http://127.0.0.1:1234/v1
LLM_MODEL=gpt-oss-20b
LLM_API_KEY=
```

Examples:

- LM Studio: `LLM_URL=http://127.0.0.1:1234/v1`
- Ollama: `LLM_URL=http://127.0.0.1:11434/v1` and `LLM_MODEL=gpt-oss:20b`
- Hosted OpenAI-compatible APIs: set `LLM_URL`, `LLM_MODEL`, and `LLM_API_KEY`

Configure CosyVoice in `.env`:

```text
COSYVOICE_PYTHON=python
COSYVOICE_MODEL_DIR=tts/models/Fun-CosyVoice3-0.5B
COSYVOICE_VENDOR=tts/cosyvoice
CASTING_VOICES_DIR=tts/voices
```

Expected local Casting paths:

- `tts/cosyvoice`: a CosyVoice source checkout, symlink, or junction
- `tts/models/Fun-CosyVoice3-0.5B`: the local CosyVoice model folder
- `tts/voices`: reference voice `.wav` files with matching `.txt` transcripts
- `scripts/casting_tts.py`: the repo-side one-shot synthesis helper

If only the LLM is missing, script analysis is disabled but manual line editing still works. If only CosyVoice is missing, TTS generation is disabled but script analysis can still work. If both are missing, Camera Lab still starts and the Casting tab reports both missing dependency groups.

## Edit Workspace

The Edit workspace is the shared UI for Bernini and Inpaint workflows.

Bernini modes:

- **T2V**: text to video.
- **I2V**: source image to video.
- **V2V / MV2V / VRC2V**: source video edits.
- **VI2V / RV2V**: source video edits with a reference image.
- **R2V**: reference image to video.
- **ADS2V**: source video plus reference video.

Inpaint mode:

- Requires a source video and a painted mask.
- Reference image is optional.
- The mask is drawn in the center canvas and uploaded before the workflow is queued.

Generated video result cards include an **Edit** menu when the output can be reused as an input. The menu can send a result video into compatible Bernini or Inpaint source slots. Video upload fields share the same clip editor modal so a trimmed clip can be reused consistently across Edit and Motion inputs.

## Browser E2E Tests

Camera Lab uses Playwright for browser-level smoke tests of the web UI.

Install Node dependencies and the Chromium test browser:

```powershell
npm install
npx playwright install chromium
```

Run the E2E suite:

```powershell
npm run test:e2e
```

The E2E suite starts the local server and verifies the public workspaces, Director timeline behavior, and Casting UI fallback states.

## Expected ComfyUI Layout

Camera Lab reads these paths from `COMFYUI_ROOT`:

- `input`
- `output`
- `models`
- `user/default/workflows`
- `custom_nodes/Comfyui_TTP_Toolset`

The setup checker verifies the important paths and files.

## Workflow Sources

The frontend workflow dropdown is populated by `WORKFLOWS` in `server/camera_lab_server.py`.

Current workflow sources are:

- Runtime builders in `server/camera_lab_server.py`.
- App-owned workflow JSON files under `workflows/app/`.

Files under `workflows/app/` are the workflow files shipped with Camera Lab. Run `python scripts/install_workflows.py` to copy them into ComfyUI for direct inspection, import, or manual queueing. Files under `workflows/experimental/` are optional research references and are only installed with `--include-experimental`.

Current dropdown mapping:

- `LTX 2.3 NAG I2V Extendcrop`: `workflows/app/ltx23_nag_i2v_extendcrop_general.json`
- `LTX 2.3 FLF TTP Control (2 images)`: built in `server/camera_lab_server.py`
- `LTX 2.3 FML (3 images, 2-stage TTP FLF)`: built in `server/camera_lab_server.py`
- `LTX 2.3 FML RuneXX Guider Local (3 images)`: `workflows/app/LTX-2.3_FML2V_RuneXX_guider.local.json`
- `LTX 2.3 IA2V`: `workflows/app/ltx23_nag_ia2v_extendcrop_general.json`
- `LTX Director Reference MVP`: `workflows/app/ltx_director_reference_mvp.json`
- `WAN2.2 Bernini T2V`: `workflows/app/wan22_bernini_t2v.ui.json`
- `WAN2.2 Bernini T2I`: `workflows/app/wan22_bernini_t2i.ui.json`
- `WAN2.2 Bernini I2V`: `workflows/app/wan22_bernini_i2v.ui.json`
- `WAN2.2 Bernini I2I`: `workflows/app/wan22_bernini_i2i.ui.json`
- `WAN2.2 Bernini V2V`: `workflows/app/wan22_bernini_v2v.ui.json`
- `WAN2.2 Bernini MV2V`: `workflows/app/wan22_bernini_mv2v.ui.json`
- `WAN2.2 Bernini VI2V`: `workflows/app/wan22_bernini_vi2v.ui.json`
- `WAN2.2 Bernini VRC2V`: `workflows/app/wan22_bernini_vrc2v.ui.json`
- `WAN2.2 Bernini R2V`: `workflows/app/wan22_bernini_r2v.ui.json`
- `WAN2.2 Bernini R2I`: `workflows/app/wan22_bernini_r2i.ui.json`
- `WAN2.2 Bernini RV2V`: `workflows/app/wan22_bernini_rv2v.ui.json`
- `WAN2.2 Bernini ADS2V`: `workflows/app/wan22_bernini_ads2v.ui.json`
- `WAN VACE Inpaint`: `workflows/app/wan_vace_inpainting.ui.json`

## Global Reference Injection Path (Director)

`LTX Director Global Reference MVP` uses a special server-side patch step to support global references from the UI.

### Default path used by Camera Lab

When a run selects director mode, `build_ltx_director_reference_api(...)` will:

1. Parse timeline payload from the request.
2. Copy global reference files (e.g. `reference_images`) to the ComfyUI input folder.
3. Copy per-segment timeline reference images to ComfyUI input.
4. Populate `LTXDirector` inputs:
   - `global_prompt`
   - `duration_frames`
   - `duration_seconds`
   - `timeline_data`
   - `local_prompts`
   - `segment_lengths`
   - `guide_strength`
   - `frame_rate`
   - `custom_width`
   - `custom_height`

### Native vs. injected compatibility mode

If the loaded ComfyUI node schema exposes both:

- `global_reference_images`
- `global_reference_strength`

on `LTXDirector`, Camera Lab sets those fields directly and skips manual graph rewriting.

If those fields are not present, Camera Lab falls back to a backward-compatible dynamic injection path:

- It creates an `LTXVAddGuideMulti` node at runtime.
- It creates one `LoadImage` node per global reference.
- It connects each reference to:
  - `global reference image`
  - `frame index` (set to `0`, global references apply from start)
  - `strength` (`global_reference_strength` from run payload)
- It rewires downstream guide-consuming sockets so the generated guide data is injected through the newly inserted node.

This fallback behavior is intentional and allows current runs to work without custom-node upgrades.

### Practical implication

- If you only want “director with global refs”, you can use the provided Camera Lab flow and this dynamic injection will work on supported workflows.
- If your custom `LTXDirector` has been updated upstream with native global-reference inputs, the behavior is cleaner and uses the native socket path automatically.
- If your run appears to have no global reference effect, check:
  - `check_setup.py` status
  - workflow installed in `<COMFYUI_ROOT>/user/default/workflows/camera-lab`
  - whether your ComfyUI `LTXDirector` has been patched with native inputs

## Included

- `server/`: Python backend, local HTTP server, and ComfyUI bridge.
- `frontend/`: static browser UI served by the Python backend.
- `scripts/`: cross-platform Python helpers plus Windows PowerShell wrappers.
- `workflows/app/`: checked-in ComfyUI workflows used by Camera Lab itself.
- `workflows/experimental/`: experimental Director / IC-LoRA workflow references.
- `docs/`: screenshots and research notes.
- `tests/`: Python unit tests and Playwright smoke tests.
- `dependency-manifest.json`: machine-readable setup summary for coding agents.
- `AGENTS.md`: concise implementation notes for coding agents.

## Repository Folders

The repository is organized so public, reusable files are separated from local run output:

- Application code lives in `server/` and `frontend/`.
- Camera Lab workflow files live in `workflows/app/`.
- Temporary runs, uploads, preview renders, prompt smoke tests, generated videos, and logs belong in `tasks/`.

`tasks/` is local-only and ignored by git. Do not put required public files there. If a workflow is needed by the app or by users, keep it under `workflows/`.

## Runtime Data

Generated runs and uploaded files are written under:

- `tasks/camera_lab_runs/`
- `tasks/camera_lab_uploads/`

Those folders are ignored by git.
