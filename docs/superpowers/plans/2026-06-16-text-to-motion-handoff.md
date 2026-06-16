# Text-to-Motion → SCAIL Pipeline — Handoff & Implementation Plan

> **For the next agent (cold start, zero context):** Read the whole **Context** section first — it documents a standalone ComfyUI environment that is NOT this repo. Then execute the Tasks. Steps use `- [ ]` checkboxes. Verify each step's expected output before moving on.

**Goal:** Install **two** text-to-motion models (Tencent **HY-Motion 1.0** and NVIDIA **Kimodo**) into the standalone SCAIL ComfyUI, generate motion from a text prompt, render it to a clean guide video, feed that into the working **SCAIL-2** video model, and **compare the two motion models** end-to-end.

**Why this pipeline:** `text → motion model → render SMPL guide video (static camera) → SCAIL-2 (pose_video) → reference character animated`. This sidesteps two dead-ends found earlier (see Context §D).

**Tech stack:** ComfyUI master 0.24.0 · conda env `comfy-scail` · torch 2.12.0+cu130 · RTX 4090 24GB · custom nodes by `jtydhr88`.

---

## Context (READ FIRST — the next agent has no memory of this)

### A. The standalone ComfyUI (where ALL this work happens — NOT the camera-lab repo)

- **Location:** `C:\Users\AIBOX\dev\ComfyUI-scail` (a `--depth 1` clone of ComfyUI master, version 0.24.0). This is SEPARATE from the user's **desktop** ComfyUI (`C:\Users\AIBOX\dev\ComfyUI` / runs on port **8000**) — DO NOT touch the desktop one; it drives the user's camera-lab LTX/ACE-Step work.
- **Python / env:** conda env `comfy-scail`. Interpreter: `C:\Users\AIBOX\anaconda3\envs\comfy-scail\python.exe` (call it `$ENVPY`). **torch 2.12.0+cu130** (this version matters — see §C).
- **Port:** 8188. **Start it** (background, from git-bash):
  ```bash
  cd /c/Users/AIBOX/dev/ComfyUI-scail
  nohup "/c/Users/AIBOX/anaconda3/envs/comfy-scail/python.exe" main.py --port 8188 --listen 127.0.0.1 > _comfy_scail.log 2>&1 &
  # wait until ready:
  for i in $(seq 1 30); do curl.exe -s --max-time 3 http://127.0.0.1:8188/system_stats >/dev/null && { echo UP; break; }; sleep 3; done
  ```
  Also a launcher exists: `C:\Users\AIBOX\dev\ComfyUI-scail\start_scail.bat`.
- **Restart** (after installing custom nodes / to free VRAM): stop then start:
  ```bash
  powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort 8188 -EA SilentlyContinue | %% { Stop-Process -Id \$_.OwningProcess -Force -EA SilentlyContinue }; Start-Sleep 3"
  ```
- **Models are SHARED** from the desktop install via `C:\Users\AIBOX\dev\ComfyUI-scail\extra_model_paths.yaml`, which points `base_path: C:/Users/AIBOX/Desktop/GEN-ART/ComfyUI/` (so `models/checkpoints`, `models/diffusion_models`, `models/text_encoders`, `models/vae`, `models/clip_vision`, `models/loras`, etc. all resolve there). New model weights generally go into `C:\Users\AIBOX\Desktop\GEN-ART\ComfyUI\models\<category>\`.

### B. SCAIL-2 is already installed and WORKING

- Native node `WanSCAILToVideo` (in ComfyUI master `comfy_extras/nodes_scail.py`). Also `SCAIL2ColoredMask`, `SAM3_VideoTrack` (SAM3 used only for replacement mode).
- Models present (in the shared GEN-ART dir):
  - diffusion_models/`wan2.1_14B_SCAIL_2_fp8_scaled.safetensors` (16.5GB, the SCAIL model)
  - loras/`lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors` (distill LoRA → 6 steps, cfg 1)
  - loras/`wan2.1_SCAIL_2_DPO_lora_bf16.safetensors` (quality LoRA, optional)
  - text_encoders/`umt5_xxl_fp8_e4m3fn_scaled.safetensors`; vae/`wan_2.1_vae.safetensors`; clip_vision/`clip_vision_h.safetensors`
  - checkpoints/`sam3.1_multiplex_fp16.safetensors` (1.74GB, SAM3 — loaded via `CheckpointLoaderSimple`)
- **Working API-format workflow:** `C:\Users\AIBOX\dev\ComfyUI-scail\scail2_native_test.json` (and `_test2.json`). Submit it via `POST http://127.0.0.1:8188/prompt` with `{"prompt": <wf>, "client_id": "..."}`.
- **Good generation config (proven):** width 480, height 832, length 49, KSampler steps 6, cfg 1.0, sampler euler, scheduler simple, ModelSamplingSD3 shift 5.0, LoraLoaderModelOnly = lightx2v distill. ≈ **6.5 s/step, ~53s total**, no OOM.
- **Combined UI workflow** `C:\Users\AIBOX\dev\ComfyUI-scail\mesh2scail_workflow.json` wires `Mesh2MotionExplore → GetVideoComponents → WanSCAILToVideo`. Built by `build_mesh2scail.py` (regenerate after editing). It LOADS and RUNS in the ComfyUI GUI.
- The SCAIL `pose_video` input is just an IMAGE sequence (driving/guide frames). A guide VIDEO is fed via `LoadVideo → GetVideoComponents → images → WanSCAILToVideo.pose_video`, and `reference_image` (a `LoadImage`) provides the character identity.

### C. CRITICAL environment lesson: torch version + VRAM

- The standalone env was upgraded to **torch 2.12.0+cu130** (`pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130`). This enabled ComfyUI's **DynamicVRAM** (no more OOM at 480×832×49) and the **cu130 optimized fp8 ops** (~7× faster: 43 s/step → 6.5 s/step). Do NOT downgrade torch.
- **VRAM thrashing gotcha:** if a generation is pathologically slow (e.g. >100 s/step) with GPU at 100% util but LOW power draw (~110W), VRAM is full and the model is being offloaded every step. Fix: kill stray python processes holding VRAM (`nvidia-smi --query-compute-apps=pid,process_name`), then restart ComfyUI 8188 for a clean CUDA context. The cosyvoice env python (`...\envs\cosyvoice\python.exe`) is a known stray VRAM holder from other work — kill it if present.

### D. WHY text-to-motion (the two dead-ends this avoids)

1. **mesh + LTX IC-LoRA** (depth/canny control): rejected because it demands the **first frame composition** align tightly with the control — too finicky for the user.
2. **mesh camera moves through SCAIL**: TESTED and confirmed **SCAIL ignores camera motion** — it maps ALL apparent motion in the guide to *character* motion. Empirical: a guide with a 46%-of-width horizontal pan → output 0% pan (recentered); a 3D camera orbit → the *character spins in place* (camera stays static). So: **author BODY motion only, keep the camera STATIC.**
- Therefore the plan: generate the exact body motion from a **text prompt** (text-to-motion), render it as a clean static-camera guide, and let SCAIL faithfully transfer the body motion onto the reference character. The user values precise, reproducible, editable motion → this earns its complexity.

### E. What is ALREADY done toward this task

- Installed custom nodes in `C:\Users\AIBOX\dev\ComfyUI-scail\custom_nodes\`: `ComfyUI-mesh2motion` (3D editor node), `ComfyUI-VideoHelperSuite` (VHS video I/O).
- **Just cloned (deps NOT yet installed):** `custom_nodes\ComfyUI-HY-Motion1\` and `custom_nodes\ComfyUI-Kimodo\` (both by jtydhr88, same author as the mesh2motion node → consistent ecosystem).
- The user's project is the open-source **camera-lab** (`C:\Users\AIBOX\dev\camera-lab`). The eventual goal is a camera-lab tab that embeds the 3D/motion tooling + exposes params + drives 8188 — but THAT is a later feature; THIS plan is only: get both motion models working + compare + feed SCAIL. The user is OK with **non-commercial (research) model licenses** (will annotate the open-source project accordingly), so Kimodo's SMPL-X research-license variant is acceptable.

### F. Dependency intel already gathered (from the two plugins' requirements/READMEs)

- **HY-Motion** (`ComfyUI-HY-Motion1`): deps = `fbxsdkpy==2020.1.post2` (from `--extra-index-url https://gitlab.inria.fr/api/v4/projects/18692/packages/pypi/simple`), `torchdiffeq>=0.2.5`, `transforms3d`, `omegaconf`, `accelerate`, `huggingface_hub`, `bitsandbytes`. Text/LLM encoder = **Qwen3-8B** (supports GGUF + CPU-offload to cut VRAM). Motion model = `tencent/HY-Motion-1.0` (full 3.89GB / Lite 1.72GB) on HF, **SMPL-H (22 joints)**, permissive license. Runs in ≤8GB VRAM.
- **Kimodo** (`ComfyUI-Kimodo`): deps = `fbxsdkpy==2020.1.post2` (same INRIA index), `hydra-core`, `omegaconf`, `peft`, `bvhio`, `trimesh`, `scenepic`. Models auto-download from HF on first use. **VRAM ~17GB** full-GPU (fits the 4090), or set env `TEXT_ENCODER_DEVICE=cpu` → <3GB (slower). Human variant = `Kimodo-SMPLX-RP-v1` (SMPL-X, **NVIDIA R&D / research license — non-commercial**). Adds **kinematic constraints** (trajectory / foot-contact) beyond text.
- ⚠️ **BIGGEST BLOCKER — Kimodo text encoder is Meta Llama-3-8B, a GATED HF model.** The user must request access at https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct and provide an HF token (`huggingface-cli login` in the `comfy-scail` env). HY-Motion's Qwen3-8B is NOT gated. **Flag this to the user early — it needs their action.**
- ⚠️ **`fbxsdkpy` (Autodesk FBX SDK python binding) is the highest install risk** on Windows + Python 3.12. If it fails, FBX export breaks but the models may still generate + render via BVH/GLB/SMPL paths. Treat FBX export as optional; the goal is a rendered **guide video**, not an FBX file.

---

## Tasks

`$ENVPY` = `C:\Users\AIBOX\anaconda3\envs\comfy-scail\python.exe`. Run pip via `"$ENVPY" -m pip ...`. Work from `C:\Users\AIBOX\dev\ComfyUI-scail`.

### Task 1 — Install HY-Motion plugin dependencies

- [ ] **Step 1:** Install deps (let `fbxsdkpy` fail soft if needed):
  ```bash
  cd /c/Users/AIBOX/dev/ComfyUI-scail
  "/c/Users/AIBOX/anaconda3/envs/comfy-scail/python.exe" -m pip install -r custom_nodes/ComfyUI-HY-Motion1/requirements.txt 2>&1 | tail -20
  ```
- [ ] **Step 2:** If `fbxsdkpy` fails, retry WITHOUT it and note FBX export is disabled:
  ```bash
  "/c/Users/AIBOX/anaconda3/envs/comfy-scail/python.exe" -m pip install torchdiffeq transforms3d omegaconf accelerate huggingface_hub bitsandbytes 2>&1 | tail -5
  ```
- [ ] **Step 3:** Verify imports: `"$ENVPY" -c "import torchdiffeq, transforms3d, omegaconf, accelerate; print('ok')"` → expect `ok`.

### Task 2 — Get HY-Motion model + Qwen3-8B text encoder

- [ ] **Step 1:** Read `custom_nodes/ComfyUI-HY-Motion1/README.md` §"Download Model Weights" for the EXACT target directory layout (it specifies a `models/` subtree). Note where it wants HY-Motion weights and the Qwen3-8B encoder.
- [ ] **Step 2:** Download HY-Motion (start with full 3.89GB) into the path the README specifies (likely under the shared `GEN-ART\ComfyUI\models\...` or the plugin's own `models/`):
  ```bash
  # example — confirm exact dest from README first:
  curl.exe -L --fail -o "<DEST>/HY-Motion-1.0_latest.ckpt" "https://huggingface.co/tencent/HY-Motion-1.0/resolve/main/HY-Motion-1.0/latest.ckpt"
  ```
- [ ] **Step 3:** Provide the Qwen3-8B encoder per README (full or GGUF). Prefer GGUF or CPU-offload if VRAM is tight alongside SCAIL. Record exact filenames/paths used.
- [ ] **Step 4:** Verify file sizes are non-trivial and headers valid (not HTML error pages).

### Task 3 — Install Kimodo plugin deps + resolve the gated Llama-3 (NEEDS USER ACTION)

- [ ] **Step 1:** **Tell the user**: Kimodo needs Meta-Llama-3-8B (gated). Ask them to (a) request access at https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct and (b) run `"$ENVPY" -m huggingface_hub.commands.huggingface_cli login` (or `huggingface-cli login`) with an HF token that has access. **Do not proceed to Task 4 until access is confirmed.**
- [ ] **Step 2:** Install Kimodo deps:
  ```bash
  "/c/Users/AIBOX/anaconda3/envs/comfy-scail/python.exe" -m pip install hydra-core omegaconf peft bvhio "trimesh>=3.21.7" scenepic 2>&1 | tail -10
  ```
  (`fbxsdkpy` shared with Task 1; skip if it failed there.)
- [ ] **Step 3:** Read `custom_nodes/ComfyUI-Kimodo/README.md` — confirm the `Kimodo Load Model` node auto-downloads, and which variant to pick (`Kimodo-SMPLX-RP-v1` for SMPL-X human). Note any `kimodo` pip package it auto-installs on first launch.

### Task 4 — Restart ComfyUI and verify both node sets load

- [ ] **Step 1:** Restart 8188 (stop + start, see Context §A).
- [ ] **Step 2:** Confirm nodes registered (HTTP 200 each):
  ```bash
  for n in HY-Motion1 KimodoLoadModel KimodoGenerate; do curl.exe -s -o /dev/null -w "$n %{http_code}\n" http://127.0.0.1:8188/object_info/$n; done
  ```
  (Exact node IDs unknown — instead grep `_comfy_scail.log` for `ComfyUI-HY-Motion1` and `ComfyUI-Kimodo` import lines and any errors, and list their nodes via `/object_info` keys containing `Motion`/`Kimodo`/`HY`.)
- [ ] **Step 3:** If a plugin failed to import, read the traceback in `_comfy_scail.log` and fix the missing dep. Common culprits: `fbxsdkpy`, `bvhio`, `scenepic`, or a torch-version mismatch.

### Task 5 — HY-Motion: text → motion → guide video

- [ ] **Step 1:** From the plugin README / its example workflow, build a minimal graph: text prompt (e.g. **"a person walks forward, stops, and waves with the right hand"**) → HY-Motion generate → render to video (the plugin has real-time 3D preview + export; find the node that outputs an IMAGE sequence or VIDEO). Keep the camera STATIC.
- [ ] **Step 2:** Run it via `/prompt` (API) or load its example workflow in the GUI and Queue. Save the rendered guide to a known file, e.g. `output/motion/hymotion_walk.mp4`.
- [ ] **Step 3:** Verify the guide video: a single clean 3D human, static camera, doing the described motion. Note resolution/fps/frame count.

### Task 6 — Kimodo: same prompt → motion → guide video

- [ ] **Step 1:** Use the SAME text prompt with `Kimodo Load Model` (`Kimodo-SMPLX-RP-v1`) → generate → render to `output/motion/kimodo_walk.mp4`. If VRAM is tight next to anything else, set `TEXT_ENCODER_DEVICE=cpu` before launching ComfyUI.
- [ ] **Step 2:** Verify the guide video the same way as Task 5.

### Task 7 — Feed each guide into SCAIL and compare

- [ ] **Step 1:** For each guide video (`hymotion_walk.mp4`, `kimodo_walk.mp4`): copy into `C:\Users\AIBOX\dev\ComfyUI-scail\input\`, then run the proven SCAIL workflow with `LoadVideo.file` = that guide, `reference_image` = `input/pirates_dancing.png` (existing test character), config 480×832×49 / 6 steps (Context §B). Use `scail2_native_test.json` patched, submit to `/prompt`.
  ```bash
  # pattern (python): load scail2_native_test.json, set node 11 inputs.file = "<guide>.mp4",
  # node 13 width/height/length = 480/832/49, node 14 steps=6, submit POST /prompt, poll /history/<id>
  ```
- [ ] **Step 2:** Collect both SCAIL outputs. **Compare** (rubric below). Confirm the BODY motion (walk + wave) transferred faithfully and the camera stayed static.
- [ ] **Step 3:** Write a short findings note (`output/motion/COMPARISON.md`): for HY-Motion vs Kimodo — motion quality, prompt adherence, render cleanliness, ease of getting a usable guide, VRAM/time, and which is better for the camera-lab feature.

---

## Success criteria

1. Both plugins import with no error in `_comfy_scail.log`; their nodes appear in `/object_info`.
2. Each model generates a coherent SMPL human motion from the SAME text prompt and renders a **static-camera guide video**.
3. Each guide drives SCAIL to produce the pirate reference character performing that motion (body motion transferred, camera static).
4. A written comparison exists with a recommendation for which model to wire into the eventual camera-lab tab.

## Comparison rubric (fill in `COMPARISON.md`)

| Criterion | HY-Motion | Kimodo |
|---|---|---|
| Prompt adherence (did it do what you typed) | | |
| Motion quality / physical plausibility | | |
| Guide render cleanliness (single human, static cam) | | |
| Control beyond text (Kimodo = kinematic constraints) | | |
| VRAM + time | | |
| Install friction (fbxsdkpy? gated Llama-3?) | | |
| License (HY-Motion permissive · Kimodo SMPLX research) | | |
| **Best for the camera-lab text→motion→SCAIL tab** | | |

## Known risks / gotchas (do not re-discover these)

- **Gated Llama-3-8B** for Kimodo → needs user HF access + login. Blocks Task 6 until resolved.
- **`fbxsdkpy`** install may fail on Win/py3.12 → FBX export optional; render to video instead.
- **Do NOT downgrade torch** (2.12.0+cu130 gives DynamicVRAM + fp8 speed). If a plugin pins an older torch, install its other deps but keep torch.
- **Do NOT touch the desktop ComfyUI (port 8000)** — only work in `dev/ComfyUI-scail` (8188).
- **VRAM thrashing** symptom = slow steps + 100% util + low watts → kill stray GPU python + restart 8188.
- SCAIL **drops camera motion** — keep guide camera static (already proven; don't waste time testing camera moves again).
