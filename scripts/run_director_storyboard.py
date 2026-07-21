#!/usr/bin/env python3
"""Submit an LTX Director v2 storyboard (images + prompts) to Camera Lab.

Examples:
  python scripts/run_director_storyboard.py --storyboard tasks/my.json --dry-run
  python scripts/run_director_storyboard.py --storyboard tasks/my.json --wait
  python scripts/run_director_storyboard.py \\
    --images a.png b.png \\
    --global-prompt "A continuous cinematic shot..." \\
    --prompts "beat one" "beat two" \\
    --durations 3 4 --wait
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import random
import shutil
import sys
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from camera_lab_common import load_env  # noqa: E402

DEFAULT_BASE_URL = "http://127.0.0.1:1234"
DEFAULT_NEGATIVE = (
    "blurry, distorted face, identity change, clothing change, flicker, "
    "jump cut, text overlay, watermark"
)
DEFAULT_GLOBAL = (
    "A continuous cinematic video with coherent subject identity, consistent "
    "lighting, natural motion, and smooth visual continuity across the full timeline."
)
UPLOAD_STAGING = REPO_ROOT / "tasks" / "camera_lab_uploads" / "storyboard"
AUDIO_STAGING = REPO_ROOT / "tasks" / "camera_lab_uploads" / "storyboard_audio"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"}


def _http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: float = 120.0) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Camera Lab at {url}: {exc}") from exc


def resolve_image_path(raw: str, base_dir: Path | None = None) -> Path:
    path = Path(raw).expanduser()
    candidates: list[Path] = []
    if path.is_absolute():
        candidates.append(path)
    else:
        if base_dir is not None:
            candidates.append((base_dir / path).resolve())
        candidates.append((REPO_ROOT / path).resolve())
        candidates.append(path.resolve())
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise FileNotFoundError(f"image not found: {raw}")


def _unique_batch_tag(prefix: str = "sb") -> str:
    """Avoid collisions when many jobs stage media in the same second."""
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def _copy_with_retry(src: Path, dest: Path, attempts: int = 6) -> Path:
    """Copy file; on Windows lock/permission errors pick a new name and retry."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    candidate = dest
    for attempt in range(attempts):
        try:
            shutil.copyfile(src, candidate)
            return candidate.resolve()
        except PermissionError as exc:
            last_err = exc
            # Another process may be reading/writing the same path.
            time.sleep(0.05 * (attempt + 1) + random.random() * 0.05)
            candidate = dest.with_name(f"{dest.stem}_{uuid.uuid4().hex[:6]}{dest.suffix}")
        except OSError as exc:
            last_err = exc
            time.sleep(0.05 * (attempt + 1))
            candidate = dest.with_name(f"{dest.stem}_{uuid.uuid4().hex[:6]}{dest.suffix}")
    raise PermissionError(f"could not stage {src} -> {dest} after {attempts} tries: {last_err}") from last_err


def stage_image(src: Path, batch_tag: str, index: int) -> Path:
    """Copy image under tasks/ so the server safe_media_path allows it."""
    UPLOAD_STAGING.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower() if src.suffix.lower() in IMAGE_SUFFIXES else ".png"
    dest = UPLOAD_STAGING / f"{batch_tag}_{index:02d}{suffix}"
    return _copy_with_retry(src, dest)


def resolve_audio_path(raw: str, base_dir: Path | None = None) -> Path:
    path = Path(raw).expanduser()
    candidates: list[Path] = []
    if path.is_absolute():
        candidates.append(path)
    else:
        if base_dir is not None:
            candidates.append((base_dir / path).resolve())
        candidates.append((REPO_ROOT / path).resolve())
        candidates.append(path.resolve())
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    raise FileNotFoundError(f"audio not found: {raw}")


def stage_audio(src: Path, batch_tag: str, index: int) -> Path:
    AUDIO_STAGING.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower() if src.suffix.lower() in AUDIO_SUFFIXES else ".wav"
    dest = AUDIO_STAGING / f"{batch_tag}_a{index:02d}{suffix}"
    return _copy_with_retry(src, dest)


def normalize_audio_segments(
    raw_audio: list[Any],
    *,
    base_dir: Path | None,
    batch_tag: str,
) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_audio or [], start=1):
        if not isinstance(raw, dict):
            continue
        audio_raw = str(raw.get("audio") or raw.get("audio_path") or raw.get("file") or "").strip()
        if not audio_raw:
            continue
        src = resolve_audio_path(audio_raw, base_dir=base_dir)
        staged = stage_audio(src, batch_tag, index)
        start = float(raw.get("start") or raw.get("start_seconds") or 0.0)
        duration = float(raw.get("duration") or raw.get("length_seconds") or 0.35)
        volume = float(raw.get("volume") if raw.get("volume") is not None else 1.0)
        segments.append(
            {
                "id": str(raw.get("id") or f"audio_{index}"),
                "audio_path": str(staged),
                "start": max(0.0, start),
                "duration": max(0.05, duration),
                "volume": max(0.0, min(4.0, volume)),
                "trimStart": max(0, int(raw.get("trimStart") or raw.get("trim_start") or 0)),
            }
        )
    return segments


def segment_prompt(raw: dict[str, Any]) -> str:
    return str(raw.get("prompt") or raw.get("local_prompt") or "").strip()


def segment_image_raw(raw: dict[str, Any]) -> str:
    return str(raw.get("image") or raw.get("image_path") or "").strip()


def segment_video_raw(raw: dict[str, Any]) -> str:
    return str(raw.get("video") or raw.get("video_path") or "").strip()


def stage_video(src: Path, batch_tag: str, index: int) -> Path:
    UPLOAD_STAGING.mkdir(parents=True, exist_ok=True)
    suffix = src.suffix.lower() or ".mp4"
    dest = UPLOAD_STAGING / f"{batch_tag}_v{index:02d}{suffix}"
    return _copy_with_retry(src, dest)


def segment_duration(raw: dict[str, Any], default: float = 3.0) -> float:
    value = raw.get("duration", raw.get("length_seconds", raw.get("length", default)))
    try:
        return max(0.25, float(value))
    except (TypeError, ValueError):
        return default


def segment_start(raw: dict[str, Any], fallback: float) -> float:
    if raw.get("start") is None and raw.get("start_seconds") is None:
        return fallback
    try:
        return max(0.0, float(raw.get("start", raw.get("start_seconds", fallback))))
    except (TypeError, ValueError):
        return fallback


def segment_strength(raw: dict[str, Any], default: float = 0.8) -> float:
    if raw.get("strength") in {None, ""}:
        return default
    try:
        return max(0.0, min(10.0, float(raw["strength"])))
    except (TypeError, ValueError):
        return default


def normalize_storyboard(
    data: dict[str, Any],
    *,
    storyboard_path: Path | None = None,
    width: int | None = None,
    height: int | None = None,
    seed: int | None = None,
    default_duration: float = 3.0,
    default_strength: float = 0.8,
) -> dict[str, Any]:
    base_dir = storyboard_path.parent if storyboard_path else None
    global_prompt = str(data.get("global_prompt") or data.get("prompt") or DEFAULT_GLOBAL).strip()
    negative = str(data.get("negative_prompt") or DEFAULT_NEGATIVE).strip()
    out_width = int(width if width is not None else data.get("width") or 768)
    out_height = int(height if height is not None else data.get("height") or 512)
    out_seed = data.get("seed") if seed is None else seed
    if out_seed is not None and out_seed != "":
        out_seed = int(out_seed)
    else:
        out_seed = ""

    raw_segments = data.get("segments") or data.get("timeline_segments") or []
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("storyboard requires a non-empty segments array")

    # Preflight: report every missing media file at once (keyframes get renamed/replaced
    # between runs; failing one-at-a-time wastes a submit cycle per missing file).
    missing: list[str] = []
    for index, raw in enumerate(raw_segments, start=1):
        if not isinstance(raw, dict):
            continue
        for label, raw_path, resolver in (
            ("image", segment_image_raw(raw), resolve_image_path),
            ("video", segment_video_raw(raw), resolve_audio_path),
        ):
            if raw_path:
                try:
                    resolver(raw_path, base_dir=base_dir)
                except FileNotFoundError:
                    missing.append(f"segment {index} {label}: {raw_path}")
    for index, raw in enumerate(list(data.get("audio_segments") or data.get("audio") or []), start=1):
        if not isinstance(raw, dict):
            continue
        audio_raw = str(raw.get("audio") or raw.get("audio_path") or raw.get("file") or "").strip()
        if audio_raw:
            try:
                resolve_audio_path(audio_raw, base_dir=base_dir)
            except FileNotFoundError:
                missing.append(f"audio {index}: {audio_raw}")
    if missing:
        raise FileNotFoundError("missing media files:\n  " + "\n  ".join(missing))

    batch_tag = _unique_batch_tag("sb")
    segments: list[dict[str, Any]] = []
    cursor = 0.0
    for index, raw in enumerate(raw_segments, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"segment {index} must be an object")
        prompt = segment_prompt(raw)
        duration = segment_duration(raw, default=default_duration)
        start = segment_start(raw, cursor)
        strength = segment_strength(raw, default=default_strength)
        image_raw = segment_image_raw(raw)
        video_raw = segment_video_raw(raw)
        image_path = ""
        video_path = ""
        seg_type = str(raw.get("type") or "").strip().lower()
        if video_raw:
            src = resolve_audio_path(video_raw, base_dir=base_dir)  # path resolve same as audio
            staged = stage_video(src, batch_tag, index)
            video_path = str(staged)
            seg_type = "video"
        elif image_raw:
            src = resolve_image_path(image_raw, base_dir=base_dir)
            staged = stage_image(src, batch_tag, index)
            image_path = str(staged)
            seg_type = "image"
        elif not seg_type:
            seg_type = "text"
        if not prompt and not image_path and not video_path:
            raise ValueError(f"segment {index} needs a prompt and/or image/video")
        item = {
            "id": str(raw.get("id") or f"s{index}"),
            "type": seg_type if seg_type in {"image", "text", "video"} else ("video" if video_path else ("image" if image_path else "text")),
            "prompt": prompt,
            "start": start,
            "duration": duration,
            "strength": strength,
            "image_path": image_path,
            "video_path": video_path,
            "trimStart": max(0, int(raw.get("trimStart") or raw.get("trim_start") or 0)),
        }
        segments.append(item)
        cursor = max(cursor, start + duration)

    total_duration = max(cursor, max(s["start"] + s["duration"] for s in segments))
    audio_segments = normalize_audio_segments(
        list(data.get("audio_segments") or data.get("audio") or []),
        base_dir=base_dir,
        batch_tag=batch_tag,
    )
    if audio_segments:
        total_duration = max(
            total_duration,
            max(a["start"] + a["duration"] for a in audio_segments),
        )
    normalized = {
        "global_prompt": global_prompt,
        "negative_prompt": negative,
        "width": out_width,
        "height": out_height,
        "seed": out_seed,
        "duration": total_duration,
        "ic_lora_name": str(data.get("ic_lora_name") or "None"),
        "ic_lora_strength": float(data.get("ic_lora_strength") or 1.0),
        "segments": segments,
        "audio_segments": audio_segments,
        "inpaint_audio": bool(data.get("inpaint_audio", True)),
    }
    if data.get("director_checkpoint"):
        normalized["director_checkpoint"] = str(data["director_checkpoint"])
    if data.get("model_overrides"):
        normalized["model_overrides"] = data["model_overrides"]
    return normalized


def storyboard_from_cli_images(
    images: list[str],
    prompts: list[str],
    durations: list[float],
    starts: list[float] | None,
    strengths: list[float] | None,
    global_prompt: str,
    negative_prompt: str,
    width: int,
    height: int,
    seed: int | None,
    default_duration: float,
    default_strength: float,
) -> dict[str, Any]:
    if not images:
        raise ValueError("--images requires at least one image path")
    segs: list[dict[str, Any]] = []
    cursor = 0.0
    for index, image in enumerate(images):
        prompt = prompts[index] if index < len(prompts) else ""
        duration = durations[index] if index < len(durations) else default_duration
        if starts is not None and index < len(starts):
            start = starts[index]
        else:
            start = cursor
        strength = strengths[index] if strengths is not None and index < len(strengths) else default_strength
        segs.append(
            {
                "id": f"s{index + 1}",
                "image": image,
                "prompt": prompt,
                "start": start,
                "duration": duration,
                "strength": strength,
            }
        )
        cursor = max(cursor, float(start) + float(duration))
    return normalize_storyboard(
        {
            "global_prompt": global_prompt or DEFAULT_GLOBAL,
            "negative_prompt": negative_prompt or DEFAULT_NEGATIVE,
            "width": width,
            "height": height,
            "seed": seed,
            "segments": segs,
        },
        default_duration=default_duration,
        default_strength=default_strength,
    )


def build_run_payload(storyboard: dict[str, Any]) -> dict[str, Any]:
    segments = storyboard["segments"]
    audio_segments = list(storyboard.get("audio_segments") or [])
    payload = {
        "workflow_id": "ltx_director_2",
        "camera_move": "director_ref",
        "source_path": "",
        "middle_path": "",
        "end_path": "",
        "duration": float(storyboard["duration"]),
        "width": int(storyboard["width"]),
        "height": int(storyboard["height"]),
        "seed": storyboard.get("seed", ""),
        "negative_prompt": storyboard.get("negative_prompt") or DEFAULT_NEGATIVE,
        "prompt": storyboard["global_prompt"],
        "global_prompt": storyboard["global_prompt"],
        "global_reference_strength": 0,
        "segments": segments,
        "timeline_segments": segments,
        "motion_segments": [],
        "audio_segments": audio_segments,
        "inpaint_audio": bool(storyboard.get("inpaint_audio", True)),
        "ic_lora_name": storyboard.get("ic_lora_name") or "None",
        "ic_lora_strength": float(storyboard.get("ic_lora_strength") or 1.0),
        "reference_images": [],
        "audio_path": "",
    }
    if storyboard.get("director_checkpoint"):
        payload["director_checkpoint"] = str(storyboard["director_checkpoint"])
    if storyboard.get("model_overrides"):
        payload["model_overrides"] = storyboard["model_overrides"]
    return payload


def upload_images_via_api(base_url: str, segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Optional: re-upload staged images through /api/upload-image for remote servers."""
    updated: list[dict[str, Any]] = []
    for segment in segments:
        item = dict(segment)
        image_path = str(item.get("image_path") or "").strip()
        if not image_path:
            updated.append(item)
            continue
        path = Path(image_path)
        raw = path.read_bytes()
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        data_url = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
        result = _http_json(
            "POST",
            f"{base_url.rstrip('/')}/api/upload-image",
            {"name": path.name, "data": data_url},
        )
        item["image_path"] = str(result.get("path") or image_path)
        updated.append(item)
    return updated


def poll_batch(base_url: str, batch_id: str, timeout: float, interval: float) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/api/batches/{batch_id}"
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = _http_json("GET", url, None, timeout=30.0)
        status = str(last.get("status") or "").lower()
        runs = last.get("runs") or []
        run_statuses = [str(run.get("status") or "").lower() for run in runs]
        print(f"[poll] batch={batch_id} status={status} runs={run_statuses}", flush=True)
        if status in {"done", "completed", "error", "failed"} or (
            runs and all(s in {"done", "completed", "error", "failed", "cancelled"} for s in run_statuses)
        ):
            return last
        time.sleep(interval)
    raise TimeoutError(f"batch {batch_id} did not finish within {timeout}s; last={json.dumps(last)[:500]}")


def load_storyboard_file(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("storyboard JSON must be an object")
    return data


def parse_float_list(values: list[str] | None) -> list[float]:
    if not values:
        return []
    return [float(v) for v in values]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run LTX Director 2 from a storyboard JSON or image list.")
    parser.add_argument("--storyboard", type=Path, help="Path to storyboard JSON")
    parser.add_argument("--images", nargs="+", help="Ordered keyframe image paths (CLI mode)")
    parser.add_argument("--prompts", nargs="*", default=[], help="Local prompts aligned with --images")
    parser.add_argument("--durations", nargs="*", default=[], help="Durations (seconds) aligned with --images")
    parser.add_argument("--starts", nargs="*", default=[], help="Optional starts (seconds) aligned with --images")
    parser.add_argument("--strengths", nargs="*", default=[], help="Optional guide strengths aligned with --images")
    parser.add_argument("--global-prompt", default="", help="Global prompt (CLI mode or override)")
    parser.add_argument("--negative-prompt", default="", help="Negative prompt override")
    parser.add_argument("--width", type=int, default=None)
    parser.add_argument("--height", type=int, default=None)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--default-duration", type=float, default=3.0)
    parser.add_argument("--default-strength", type=float, default=0.8)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"Camera Lab URL (default {DEFAULT_BASE_URL})")
    parser.add_argument("--upload-api", action="store_true", help="Upload images via /api/upload-image before run")
    parser.add_argument("--dry-run", action="store_true", help="Print payload only; do not submit")
    parser.add_argument("--wait", action="store_true", help="Poll until the batch finishes")
    parser.add_argument("--timeout", type=float, default=3600.0, help="Max wait seconds when --wait")
    parser.add_argument("--interval", type=float, default=5.0, help="Poll interval seconds")
    parser.add_argument("--write-payload", type=Path, help="Optional path to write the /api/run payload JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    load_env()
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.storyboard and args.images:
        parser.error("use either --storyboard or --images, not both")
    if not args.storyboard and not args.images:
        parser.error("provide --storyboard or --images")

    if args.storyboard:
        path = args.storyboard.expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(path)
        data = load_storyboard_file(path)
        if args.global_prompt:
            data["global_prompt"] = args.global_prompt
        if args.negative_prompt:
            data["negative_prompt"] = args.negative_prompt
        storyboard = normalize_storyboard(
            data,
            storyboard_path=path,
            width=args.width,
            height=args.height,
            seed=args.seed,
            default_duration=args.default_duration,
            default_strength=args.default_strength,
        )
    else:
        storyboard = storyboard_from_cli_images(
            images=list(args.images or []),
            prompts=list(args.prompts or []),
            durations=parse_float_list(args.durations),
            starts=parse_float_list(args.starts) or None,
            strengths=parse_float_list(args.strengths) or None,
            global_prompt=args.global_prompt,
            negative_prompt=args.negative_prompt,
            width=args.width or 768,
            height=args.height or 512,
            seed=args.seed,
            default_duration=args.default_duration,
            default_strength=args.default_strength,
        )

    payload = build_run_payload(storyboard)

    if args.upload_api and not args.dry_run:
        segments = upload_images_via_api(args.base_url, payload["timeline_segments"])
        payload["timeline_segments"] = segments
        payload["segments"] = segments

    if args.write_payload:
        args.write_payload.parent.mkdir(parents=True, exist_ok=True)
        args.write_payload.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote payload: {args.write_payload}")

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    batch = _http_json("POST", f"{args.base_url.rstrip('/')}/api/run", payload)
    batch_id = batch.get("batch_id")
    print(json.dumps({"batch_id": batch_id, "status": batch.get("status"), "runs": batch.get("runs")}, ensure_ascii=False, indent=2))
    if not batch_id:
        raise RuntimeError("server response missing batch_id")

    if args.wait:
        final = poll_batch(args.base_url, str(batch_id), timeout=args.timeout, interval=args.interval)
        print(json.dumps(final, ensure_ascii=False, indent=2))
        status = str(final.get("status") or "").lower()
        run_statuses = [str(run.get("status") or "").lower() for run in (final.get("runs") or [])]
        if status in {"error", "failed"} or any(s in {"error", "failed"} for s in run_statuses):
            return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 - CLI surface
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
