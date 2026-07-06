# ≥8GB Quantized Profiles & Workflow Variants (Sub-Project B)

**Date:** 2026-06-27
**Status:** Approved design, ready for implementation plan
**Branch:** feature/modular-installer

## Context

Camera Lab's modular installer already detects hardware, registers module/model
profiles, reads ComfyUI `/object_info` visibility, and resolves per-module
readiness (recommended/risky/unavailable). Today every module's *ready* profile
is FP8 and needs 16GB+ VRAM, so the resolver marks all 8–12GB GPUs as `risky`.

The goal of the wider effort is to let a from-zero Windows user with a common
N-card run Camera Lab. This sub-project (B) makes that possible for the large
population of **≥8GB** GPUs by giving each base-model family a **verified
low-VRAM quantized path**. A separate sub-project (A, the browser setup wizard)
is sequenced *after* B and is out of scope here.

This sub-project is **accuracy-critical**: a wrong GGUF filename or an
unreachable URL breaks a beginner's workflow with no way to self-diagnose.
Nothing here is written from memory — every model file and node must be verified
against real repositories at implementation time.

## Goal

For each base-model family used by the bundled workflows, deliver a verified
quantized profile plus a GGUF workflow variant, registered into the existing
matrix so the resolver marks ≥8GB GPUs as `recommended` for the corresponding
modules.

## Key Insight: Two Families, Not Five Modules

The bundled workflows reduce to two base-model families plus small LoRAs:

- **LTX family** — `camera`, `director` (LTX 2.3 22B + distilled LoRA + spatial
  upscaler + Gemma text encoder)
- **WAN family** — `edit`, `motion` (WAN2.2 Bernini / WAN2.1 VACE / SCAIL2 +
  lightx2v 4-step LoRAs + UMT5 text encoder + Wan VAE)

`casting` has no large diffusion model (its TTS already ships small 0.5B / MLX
options) and is out of scope.

**LoRAs are not quantized.** They are small and quant-agnostic; the quantized
path keeps the existing distilled / lightx2v LoRAs unchanged. The substitution
is intentionally narrow: swap the large diffusion model FP8→GGUF, swap the
text encoder to a GGUF variant with a GGUF loader node, and keep everything else.

**Quantization is a VRAM-keyed ladder, not a single tier.** Each family
registers multiple quant profiles spanning quant levels, and the resolver
recommends the highest-quality tier that fits the user's actually-detected VRAM.

## Verified Findings (research, 2026-06-27)

These confirm the design rests on real artifacts. Exact filenames/sizes are
re-verified per-file during implementation.

### LTX family
- `QuantStack/LTX-2.3-GGUF` exists with distilled Q2_K→Q8_0
  (`LTX-2.3-distilled/LTX-2.3-distilled-Q4_K_S.gguf` ≈16.7GB, Q4_K_M ≈17.8GB,
  Q8_0 ≈25.5GB).
- **Correction needed:** current `modules.py` references
  `diffusion_models/LTXvideo/LTX-2/quantstack/LTX-2.3-distilled-Q4_K_S.gguf`,
  which is a wrong/local path. The real HF source is the QuantStack repo above.
- `city96/ComfyUI-GGUF` provides `UnetLoaderGGUF`, `CLIPLoaderGGUF`,
  `DualCLIPLoaderGGUF`, `UnetLoaderGGUFAdvanced`.
- **Bottleneck — text encoder, not the diffusion model.** Gemma 3 12B is large;
  GGUF Gemma support for LTX is still maturing (city96 issue #398, Lightricks
  feature request #303 for smaller/quantized Gemma on <32GB VRAM). The min-VRAM
  number for the LTX quant profile is driven by the text encoder and must be
  set from the verified Gemma GGUF, not the diffusion model alone.

### WAN family
- `neuregex/Bernini-R-GGUF` exists: dual-expert (high+low noise) GGUF, Q5_K_M
  recommended / Q4_K_M lowest VRAM. Requires `ComfyUI-BerniniR` + `ComfyUI-GGUF`
  plus Wan VAE and UMT5. Maps directly to the `edit` module's Bernini workflows.
- `QuantStack/Wan2.2-*-A14B-GGUF` and `city96/Wan2.1-T2V-14B-gguf` exist as
  fallbacks for VACE-style paths.
- **Gap — SCAIL2 (motion):** no public GGUF conversion found. The `motion`
  module's 8GB path is **not deliverable**; it is marked honestly rather than
  faked.

## Deliverables

1. **Registry corrections + verified quant ladders** in
   `scripts/camera_lab_setup/modules.py`:
   - LTX quant **ladder** (`camera` + `director`): multiple profiles across
     quant levels (e.g. Q8_0 / Q4_K_M / Q4_K_S, and a Q3/Q2 8GB tier only if a
     loadable quantized Gemma makes it fit). Each tier has correct GGUF filename
     + real `source_url`, verified `disk_gb`, and `min_vram_gb`/
     `recommended_vram_gb` set from the **combined (diffusion GGUF + text-encoder
     GGUF) footprint** — the text encoder, not the diffusion model, sets the
     floor.
   - WAN/Bernini quant **ladder** (`edit`): Bernini-R-GGUF tiers (e.g. Q5_K_M /
     Q4_K_M) with filenames + sources, verified disk/VRAM.
   - Each quant profile lists its GGUF `required_nodes`
     (`ComfyUI-GGUF`, plus `ComfyUI-BerniniR` for Bernini).
   - `motion`/SCAIL2: explicitly marked "no quantized variant available";
     resolver continues to report `risky` for 8GB with a clear reason.
2. **VRAM-aware resolver tier selection** in
   `scripts/camera_lab_setup/resolver.py`: among the *ready* quant profiles of a
   module, select the highest-quality tier whose `min_vram_gb ≤ detected VRAM`;
   if none fit, select the smallest tier and mark `risky` with a reason. This
   replaces the current "last ready profile wins" selection and is what makes
   "recommend by actual VRAM" work. FP8 and quant profiles coexist; the fitting
   logic spans both.
3. **GGUF workflow variants** under `workflows/`: one LTX, one WAN/Bernini,
   cloned from the existing FP8 workflow with the loader nodes swapped
   (`UNETLoader`→`UnetLoaderGGUF`, CLIP loader→GGUF variant) and model
   references pointed at the registered GGUF filenames. One variant per family
   serves the whole ladder (the loader reads whichever GGUF file is present).
4. **Verification tests** (`tests/`): assert every quant profile's model
   `source_url` is reachable (HTTP HEAD); that each GGUF workflow variant only
   references nodes and model filenames present in the registry / a mocked
   `object_info` exposing the GGUF loader nodes; and that the resolver picks the
   correct tier across a band of VRAM sizes (8/12/16/24GB).

## Verification Bar ("accurate" defined)

A quant path is "accurate" when:
- Every quantized model file has a confirmed reachable URL (HTTP HEAD/listing)
  and exact filename + folder.
- The GGUF loader nodes the workflow variant uses exist in ComfyUI
  `object_info`, and the registered model becomes visible through them.

**Out of scope:** real-machine generation, measuring the actual 8GB VRAM
ceiling, and any setup-wizard UI (that is sub-project A).

## Architecture & Reuse

No new packages. Changes are confined to:
- `scripts/camera_lab_setup/modules.py` — quant ladder data (profiles,
  filenames, URLs, VRAM/disk, `required_nodes`).
- `scripts/camera_lab_setup/resolver.py` — VRAM-aware tier selection among
  ready profiles (the one behavioral change).
- `workflows/` — two new GGUF workflow JSON variants (one per family).
- `tests/` — URL-reachability, workflow/registry-consistency, and tier-selection
  checks.

`visibility.py`, `hardware.py`, and the storage/download logic already consume
these profiles unchanged. Correctly registered quant ladders plus the resolver's
fit-to-VRAM selection flip 8–12GB GPUs to `recommended` for
`camera`/`director`/`edit`. The `edit-vace14-gguf` / `camera-ltx23-gguf-q4`
stubs are replaced by the verified ladders.

## Data Flow

```
modules.py quant profile (verified GGUF model + GGUF text encoder + nodes)
  → resolver.resolve_module() uses min_vram_gb from the text encoder
  → 8–12GB GPU now matches a ready quant profile → "recommended"
  → GGUF workflow variant installed alongside FP8 variant
  → object_info exposes UnetLoaderGGUF / DualCLIPLoaderGGUF → model_visible() true
```

## Testing

- URL reachability: HTTP HEAD each registered quant `source_url` (network test,
  marked so it can be skipped offline).
- Workflow/registry consistency: parse each GGUF workflow variant; every model
  filename it loads exists in the matching quant profile; every loader node it
  uses is a known GGUF node.
- Resolver tier selection: with a mocked `object_info` exposing the GGUF nodes
  and models, sweep `HardwareProfile` VRAM across 8/12/16/24GB and assert the
  resolver picks the highest-quality fitting quant tier for
  `camera`/`director`/`edit` (and `recommended` vs `risky` accordingly);
  `motion` stays `risky` with its reason.

## Risks & Honest Gaps

- **Gemma GGUF for LTX is maturing.** If a verified, loadable Gemma-3 GGUF +
  loader path cannot be confirmed, the LTX quant profile's text-encoder entry
  must record the best verified option (e.g. lowest-bpp Gemma that loads) and
  the `min_vram_gb` reflects it; if none loads, the LTX 8GB path is downgraded
  to `risky` honestly rather than shipped broken.
- **SCAIL2 has no public GGUF.** `motion` 8GB stays unsupported by design.
- **Filenames/sizes drift.** All values are re-verified at implementation time;
  none are trusted from memory or from the current (partly wrong) registry.
