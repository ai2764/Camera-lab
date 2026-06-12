# Director last-frame bleed (LTX 0.24.x regression)

**Status:** Paused — multiple fix paths identified, none implemented yet.

## Symptom

LTX Director runs (camera-lab) on ComfyUI 0.24.x show the global reference image
bleeding into the last ~6–16 frames of long videos (16 s and longer) as a ghost
overlay. The output is also one second (24 frames) longer than the requested
`duration_frames` — e.g. asking for 384 frames produces 409.

Pre-upgrade runs on ComfyUI 0.22.3 (Jun 6) with the same seed and parameters
produced clean 16 s output. The regression is purely from the ComfyUI upgrade.

## Root cause

ComfyUI core PR
[#13882](https://github.com/Comfy-Org/ComfyUI/pull/13882) ("Stop
LTXVCropGuides leaving stray latent frames when guides share a start position")
landed in 0.24.0 and reworked how LTX guides register attention entries:

- New `_append_guide_attention_entry` API in `comfy_extras.nodes_lt`.
- `LTXVCropGuides.execute` and `LTXVAddGuide.get_latent_index` now thread token
  counts via this API.
- Stock LTX 2.3 / FLF nodes were updated in lock-step and work fine on 0.24.x.

The third-party `WhatDreamsCost-ComfyUI` `LTXDirectorGuide` node was not
updated. Camera-lab uses this node via the `LTXVAddGuideMulti` fallback path.
Two consequences:

1. **Frame count drift.** `LTXVCropGuides` cropping mis-aligns because guide
   tokens are not counted via the new API. Output is +1 second longer than
   requested.
2. **Bleed at the tail.** Global references inserted at `frame_idx=0` register
   attention entries that propagate via the new attention-mask code, leaking
   into the last frames.

A second user on ComfyUI 0.24.0 + frontend 1.44.19 reported the same
end-of-video distortion with LTX Director but not with the stock LTX 2.3 / FLF
workflow, confirming the issue is `WhatDreamsCost`-specific.

## What we've already done

- Local patch to
  `custom_nodes/WhatDreamsCost-ComfyUI/ltx_director_guide.py` adding a
  `_append_guide_attention_entry` call after `append_keyframe`. Fixes the
  `guide pre_filter_counts != keyframe grid mask length` crash. **Not
  committed and not pushed to the fork.**
- camera-lab branch `director-node-fork-compat` (commit `bf4934e`,
  **not pushed**) that strips the `MultiReferenceImageLoader` chain, always
  uses the `LTXVAddGuideMulti` fallback, and defensively clears native
  `global_reference_images` / `global_reference_strength` keys when the node
  declares them.
- camera-lab `insert_director_multi_guide` reverted to hardcoded `["58", 2]`
  (slot 2 = LTXDirectorGuide 58's OUTPUT latent), matching commit `339355f`
  behaviour. The WIP "auto-pick highest scale_by" version routed through an
  upsampled latent and made things worse.

## Still broken

Long videos (16 s and longer) with global references still bleed at the tail.
The `_append_guide_attention_entry` patch fixes the frame count and the crash
but does not address attention propagation from the `frame_idx=0` global
references.

## Planned fix paths (ordered by effort)

1. **Skip global refs on long clips.** Camera-lab auto-omits global-ref
   injection when `duration_seconds > 8`, or surfaces a UI warning. Cheapest
   to ship.
2. **Move global ref `frame_idx` off 0.** Try placing them mid-timeline
   (e.g. `duration_frames // 2`) so the attention is not anchored at the
   start where it propagates forward strongly. Easy to test in
   `insert_director_global_reference_guides`.
3. **Generate `+N` extra frames and trim.** LTX community standard
   workaround. Bump `duration_frames` by 24, let LTX drift in the buffer
   zone, trim those last 24 frames in post-processing.
4. **Patch upstream `WhatDreamsCost-ComfyUI` LTXDirectorGuide for 0.24.x.**
   Real fix — adapt the node so its guide encoding actually reflects PR
   #13882's new attention / token accounting (not just calling
   `_append_guide_attention_entry`). Submit a PR upstream.
5. **Drop the dependency.** Switch camera-lab Director runs to ComfyUI core's
   native LTX guide nodes, the same path FLF uses. Biggest rewrite but the
   most robust outcome.

## Resume notes

- ComfyUI version when the regression appeared: 0.24.1, frontend 1.44.19,
  upgraded from 0.22.3 on Jun 7 21:47 PT via Desktop auto-update.
- Affected workflow: `workflows/app/ltx_director_reference_mvp.json`.
- Workaround proven to work: Jun 6 pre-upgrade runs with the same seed and
  parameters produced clean 16 s output. The issue is purely the upgrade.

## Related files

- `server/camera_lab_server.py` —
  `build_ltx_director_reference_api`,
  `insert_director_global_reference_guides`,
  `insert_director_multi_guide`,
  `strip_director_image_loader_chain`.
- `<COMFYUI_ROOT>/custom_nodes/WhatDreamsCost-ComfyUI/ltx_director_guide.py`
  — local patch with the `_append_guide_attention_entry` call.
- Repro assets: external local scratch folder (ref2.png
  three-view + timeline_1 / timeline_3).

## References

- [ComfyUI PR #13882](https://github.com/Comfy-Org/ComfyUI/pull/13882) —
  LTXVCropGuides stray latent frames fix (the change that broke us).
- Community workarounds for LTX last-frame drift: trim +8 frames, cap clips
  at ~5 s (121 frames), set last-frame `frame_idx=-12` instead of `-1`.
