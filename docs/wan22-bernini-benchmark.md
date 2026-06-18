# WAN2.2 Bernini — Local Benchmark (RTX 4090 24GB)

Capacity test for `workflows/app/wan22_bernini_video_edit.ui.json` on the local
standalone ComfyUI. Answers: **how long / how large a video can this box render.**

## Environment

- GPU: RTX 4090, 24 GB
- ComfyUI 0.24.0 · Python 3.12 · torch 2.12.0+cu130 (DynamicVRAM, fp8 cu130 ops)
- System RAM: 95 GB (used for DynamicVRAM offload)
- Models: `Wan22_Bernini_HIGH/LOW_fp8_e4m3fn_scaled` (~14.5 GB each, dual MoE
  experts) + `wan2.2_t2v_A14b_{high,low}_noise_lora_rank64_lightx2v_4step_1217`
  + `umt5_xxl_fp8` + `wan_2.1_vae`
- Sampling: BasicScheduler `simple` steps 6 → SplitSigmas step 3 → two-stage
  SamplerCustom (high 3 + low 3), euler, cfg 1, fps 24, ref_max_size 848, seed 42
- Task: **v2v** (source_video only; reference dropped to keep the API run simple)
- `PathchSageAttentionKJ` **bypassed** — SageAttention is not installable on this
  torch 2.12+cu130 stack (no prebuilt wheel; CUDA 13.0 toolkit + MSVC + triton
  build chain incomplete). It is an attention speedup only and does not affect
  whether a render succeeds.
- Source clip: `dance_9003381.mp4`

## Results

| Resolution | Frames | Duration | Gen time | Peak VRAM | Output | Result |
|---|---|---|---|---|---|---|
| 480×832 | 33  | 1.4 s | 51 s          | 19.1 GB | 0.29 MB | OK |
| 480×832 | 49  | 2.0 s | 87 s          | 18.7 GB | 0.35 MB | OK |
| 480×832 | 81  | 3.4 s | 184 s         | 18.7 GB | 0.64 MB | OK |
| 480×832 | 121 | 5.0 s | 364 s (~6 min)| 20.3 GB | 0.96 MB | OK |
| 720×1280 | 49  | 2.0 s | 344 s         | 14.3 GB* | 0.73 MB | OK |
| 720×1280 | 81  | 3.4 s | 822 s (~14 min)| 22.0 GB | 1.29 MB | OK |
| 720×1280 | 121 | 5.0 s | 2422 s timeout | 23.9 GB (pinned) | — | **FAIL (VRAM thrash)** |

\* The 720×1280 L49 peak (14.3 GB) is low because the 4 s sampler missed the
spike; treat it as anomalous, not a real reading.

## Practical limits on this 24 GB card

| Resolution | Max feasible | Notes |
|---|---|---|
| **480×832 (portrait)** | **5.0 s (121 frames) / ~6 min** | comfort zone, ~20 GB peak |
| **720×1280 (portrait)** | **3.4 s (81 frames) / ~14 min** | 22 GB, at the ceiling |
| 720p ≥ 5 s | ❌ not feasible | crosses the VRAM red line |

### Why 720p 5 s fails

720×1280 L121 wedged: VRAM pinned at 23.9 GB, GPU 100 % util but power dropped to
**~120 W** (vs ~450 W when healthy) — the classic VRAM-thrashing signature. Every
step swaps weights/activations in and out, so the GPU spins with near-zero
progress. 40-minute timeout, no output. Peak system RAM reached 72 GB (offload
helped but could not rescue it).

## Takeaways

- **VRAM is the hard bottleneck, set by resolution.** Frame count barely moves the
  peak (480×832: 33→121 frames only 19→20 GB); resolution does (720p L81 = 22 GB).
- **Gen time scales ~linearly with frames**, steeper at long sequences:
  ~3 s/frame at 480×832, ~10 s/frame at 720×1280 (2.25× the pixels → ~3× per-frame cost).
- Single pass tops out at ~5 s (480×832) / ~3.4 s (720p). `BerniniConditioning`
  exposes no continuation/previous-frames input, so longer clips need a separate
  chunking approach.
- To push further: lower frames/resolution, a larger-VRAM GPU, or a memory-saving
  attention kernel (SageAttention — currently un-installable on this cu130 stack).
