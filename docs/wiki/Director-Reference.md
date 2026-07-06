# Director Reference

Director uses `LTX Director 2` from:

```text
workflows/app/ltx_director_2.json
```

The older `ltx_director_reference_mvp.json` v1 reference workflow has been
retired.

## Global Reference Status

Director v2 global reference images are placeholder UI in the current app. The
active v2 path supports timeline segments, IC reference clips, audio segments,
and retake payloads. Native global reference image wiring is planned for a later
integration pass.

## Legacy Compatibility Path

For legacy Director reference behavior, `build_ltx_director_reference_api(...)`
can:

1. Parse timeline payload from the request.
2. Copy global reference files to the ComfyUI input folder.
3. Copy per-segment timeline reference images to ComfyUI input.
4. Populate `LTXDirector` inputs such as global prompt, duration, timeline data,
   local prompts, segment lengths, guide strength, frame rate, and frame size.

## Native Vs Injected Reference Handling

If the loaded ComfyUI node schema exposes both:

- `global_reference_images`
- `global_reference_strength`

on `LTXDirector`, Camera Lab sets those fields directly.

If those fields are not present, Camera Lab falls back to a dynamic injection
path:

- Creates an `LTXVAddGuideMulti` node at runtime.
- Creates one `LoadImage` node per global reference.
- Connects each reference to global reference image, frame index, and strength.
- Rewires downstream guide-consuming sockets through the inserted node.

This compatibility path allows older runs to keep working without forcing a
custom-node upgrade.

## Troubleshooting

If a legacy run appears to have no global reference effect, check:

- `python scripts/check_setup.py`
- The workflow installed in `<COMFYUI_ROOT>/user/default/workflows/camera-lab`
- Whether your ComfyUI `LTXDirector` node exposes native global-reference inputs

