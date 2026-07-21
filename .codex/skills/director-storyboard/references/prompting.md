# Director storyboard prompting

## Mental model

LTX Director v2 combines:

1. **Prompt Relay** — routes each local prompt to a time window (`local_prompts` joined by ` | `).
2. **Keyframe guides** — image (or video) latents appended at `insert_frame` with a strength.

Images **guide** generation toward a composition at a time. They do not automatically invent the motion between two stills — **you write that motion**.

## Global prompt

- One flowing English paragraph (LTX style).
- Anchor: subject identity, wardrobe, location, lighting, style, continuity.
- Think cinematographer shot list, not keyword soup.
- Prefer ~4–8 sentences, under ~200 words.

Template:

```text
A continuous cinematic shot of [subject + identity markers], wearing [wardrobe],
in [location / time / weather]. [Lighting + color]. The camera [default language].
Coherent subject identity, consistent wardrobe and lighting, natural motion,
and smooth visual continuity across the full timeline.
```

## Local prompts

Per segment:

- Present tense verbs for body and camera.
- Only events that belong in this window.
- Relay from previous beat (continue, don't reset world).
- Quote dialogue: `She says softly, "I'm sorry."`
- Match duration to complexity.

Bridge pattern between keyframe A and B:

```text
[Shot scale matching A]. Starting from [pose A]. [Action that moves toward B].
[Camera move]. [Secondary motion: rain, cloth, hair]. Arrives at [pose/composition B].
```

## Keyframe placement

| Goal | Placement |
|---|---|
| Open on a still | Image at `start: 0` |
| Land on a still | Image segment near timeline end |
| Middle beat | Image at the time the composition should appear |
| Soft identity only | Lower strength (0.5–0.65) |

## Strength

| Value | Effect |
|---|---|
| 0.5–0.65 | Loose guide, freer motion — rarely worth the drift off the keyframe art |
| 0.7–0.85 | Balanced; practical default is **0.78–0.85** |
| 0.9–1.0 | Sticky; may freeze / ghost if conflicting (1.0 for video guides when extending) |

Do not lower strength to fix a static "slideshow" result — that trades away keyframe
fidelity. Keep 0.78–0.85 and fix it in the prompts: ongoing motion in every beat
(light flicker, wind, breathing, churning clouds, drifting camera) plus anti-static
negatives (`slideshow, still photograph, freeze frame, static image, motionless scene`).

## Duration vs complexity

| Content | Min duration |
|---|---|
| Blink / micro head turn | 1.5s |
| Gesture or short walk | 2.5–4s |
| Track + major pose change | 4–8s |

## Anchoring new events / extending takes

- To extend a good take: video segment (strength ~1.0, its original duration) + new tail
  segments. A **text-only tail after a strong video guide is often ignored** — the model
  keeps coasting on the video's mood and the new event never fires.
- Anchor the new event with an image guide at ~0.75–0.8. A frame extracted from a
  previous successful run (`ffmpeg -ss <t> -i take.mp4 -frames:v 1 guide.png`) is the
  ideal anchor: it already matches the world, palette and lens.
- New world elements (a storm front, an arriving ship) must exist from frame one as a
  distant/background presence and approach gradually — otherwise they pop into existence
  mid-shot. State this in the global prompt and negative-prompt the sudden version
  (`black clouds appearing suddenly, instant weather change`).

## Avoid

- Different people/clothes/locations across keyframes of one continuous shot
- Static photo captions without verbs
- Competing multi-scene events in one short segment
- Relying on vague style words (`epic`, `cinematic`) without motion verbs
