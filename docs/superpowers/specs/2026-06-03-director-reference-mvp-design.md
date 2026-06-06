# Director Reference MVP Design

## Goal

Build a Camera Lab MVP that runs a full LTX Director timeline with user-uploaded reference setting images. The UI lets the user add reference images, edit timeline segments, generate the complete timeline, inspect segment ranges in the resulting full video, and rerun the complete timeline after edits.

## Scope

In scope:
- One full-video generation per run.
- No historical comparison UI.
- Reference images for character, scene, prop, and style.
- Timeline segments with prompt, duration, guide frame, and reference strength.
- Full-video output plus segment metadata for preview navigation.

Out of scope:
- Regenerating only one segment.
- Stitching separately generated segments.
- Persistent project storage beyond the existing run output directories.
- Pixel-perfect timeline editor polish.

## Workflow Architecture

The MVP uses the existing `LTX Director Example Workflow (Fixed).json` as the base graph because it already has the LTX Director timeline node, two-stage sampling, upscaling, audio latent flow, and `SaveVideo`.

Reference images are injected using the 20-grid workflow idea: `LTXVAddGuideMulti` takes up to four user reference images and inserts them into the video latent/conditioning at selected frame indices and strengths. The generated video is always the full timeline.

## UI Architecture

The existing Camera Lab page gains a Director MVP mode:
- Reference panel: four upload slots for character, scene, prop, and style.
- Timeline panel: editable segment rows containing prompt, duration seconds, reference role, guide frame, and strength.
- Output panel: the normal result card remains; each run also carries segment metadata so the UI can show segment buttons and seek the full video to each segment.

## Data Model

The UI submits:

```json
{
  "workflow_id": "ltx_director_reference_mvp",
  "global_prompt": "persistent world and character description",
  "segments": [
    {
      "prompt": "shot description",
      "duration": 4,
      "reference": "character",
      "guide_frame": 0,
      "strength": 0.7
    }
  ],
  "reference_images": {
    "character": "uploaded path",
    "scene": "uploaded path",
    "prop": "uploaded path",
    "style": "uploaded path"
  }
}
```

The backend converts this to a full LTX Director API prompt, queues it in ComfyUI, and saves `director_timeline.json` beside `api_prompt.json` in the run directory.

## Success Criteria

- Camera Lab lists a new `LTX Director Reference MVP` workflow.
- The UI exposes reference image uploads and timeline rows for that workflow.
- Submitting a director run writes a valid ComfyUI API prompt containing `LTXDirector` and `LTXVAddGuideMulti`.
- Completed runs retain segment metadata and can seek the full output video by segment.
