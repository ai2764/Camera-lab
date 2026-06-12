"""On-demand CosyVoice batch synthesis for the camera-lab Casting tab.

Runs under the configured CosyVoice Python environment, not camera-lab's
interpreter. Loads the model once, synthesizes every line in the job, writes
<out_name>.wav into out_dir, and prints one JSON progress line per file to
stdout. Exits non-zero if nothing rendered.

Instruct format follows the official CosyVoice recommendation: CV3 requires
the "You are a helpful assistant. <|endofprompt|>" envelope; CV2 just needs the
token. Each emotion's directive is a full natural-language sentence.

Usage: python casting_tts.py <job.json>
  job = {lines:[{text,voice,emotion,out_name}], voices:{id:{ref_wav,ref_text}},
         emotions:{id:directive}, model_dir, vendor, version, out_dir}
"""
import json
import os
import random
import sys


def log(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def ensure_endofprompt(prompt_text: str) -> str:
    """CV3 zero-shot requires <|endofprompt|> in the prompt_text."""
    if "<|endofprompt|>" in prompt_text:
        return prompt_text
    return f"You are a helpful assistant.<|endofprompt|>{prompt_text}"


def build_directive(directive: str, version: str) -> str:
    """Wrap a natural-language emotion directive into the version-correct instruct."""
    if not directive:
        return ""
    if "<|endofprompt|>" in directive:
        return directive
    if version == "cv3":
        return f"You are a helpful assistant. {directive}<|endofprompt|>"
    return f"{directive}<|endofprompt|>"


def clamp_speed(value) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        speed = 1.0
    return max(0.6, min(1.4, speed))


def main() -> int:
    job = json.loads(open(sys.argv[1], encoding="utf-8").read())
    vendor = job["vendor"]
    sys.path.insert(0, vendor)
    sys.path.insert(0, os.path.join(vendor, "third_party", "Matcha-TTS"))

    import torch
    import torchaudio
    from cosyvoice.utils.common import set_all_random_seed

    version = job.get("version", "cv2")
    model_dir = job["model_dir"]
    if version == "cv3":
        from cosyvoice.cli.cosyvoice import CosyVoice3
        model = CosyVoice3(model_dir, load_trt=False, load_vllm=False, fp16=False)
    else:
        from cosyvoice.cli.cosyvoice import CosyVoice2
        model = CosyVoice2(model_dir, load_jit=False, load_trt=False, load_vllm=False, fp16=False)
    sr = model.sample_rate
    log({"event": "loaded", "version": version, "sample_rate": sr})

    voices = job["voices"]
    emotions = job["emotions"]
    out_dir = job["out_dir"]
    os.makedirs(out_dir, exist_ok=True)

    ok = 0
    lines = job["lines"]
    for line in lines:
        text = line["text"]
        out_name = line["out_name"]
        voice = voices.get(line["voice"]) or next(iter(voices.values()))
        ref_wav = voice["ref_wav"]
        ref_text = voice.get("ref_text", "")
        speed = clamp_speed(line.get("speed", 1.0))
        directive = build_directive(emotions.get(line.get("emotion", "neutral"), ""), version)
        try:
            set_all_random_seed(random.randint(1, 10**8))
            if directive:
                it = model.inference_instruct2(text, directive, ref_wav, stream=False, speed=speed)
            else:
                prompt_text = ensure_endofprompt(ref_text) if version == "cv3" else ref_text
                it = model.inference_zero_shot(text, prompt_text, ref_wav, stream=False, speed=speed)
            parts = [chunk["tts_speech"] for chunk in it]
            if not parts:
                raise RuntimeError("empty output from CosyVoice")
            speech = torch.cat(parts, dim=1)
            peak = speech.abs().max()
            if peak > 0.8:
                speech = speech / peak * 0.8
            out_path = os.path.join(out_dir, f"{out_name}.wav")
            torchaudio.save(out_path, speech, sr, format="wav")
            ok += 1
            log({"event": "clip", "name": out_name, "file": out_path, "speed": speed})
        except Exception as exc:  # noqa: BLE001 - report and continue
            log({"event": "error", "name": out_name, "error": str(exc)})

    log({"event": "done", "ok": ok, "total": len(lines)})
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
