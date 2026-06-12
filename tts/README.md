# Camera Lab TTS

This directory is the repo-local home for Casting tab TTS integration.

Expected local layout:

```text
tts/
  cosyvoice/                    # CosyVoice source checkout or vendor copy
  models/Fun-CosyVoice3-0.5B/   # CosyVoice model files
  voices/                       # reference wav/txt voice profiles
  library/current/              # generated current voice clips
  library/archive/              # timestamped archived batches
```

Large model files, local CosyVoice source, generated clips, and private reference voices are ignored by git.

Set these in `.env` when your local paths differ:

```env
COSYVOICE_PYTHON=python
COSYVOICE_MODEL_DIR=tts/models/Fun-CosyVoice3-0.5B
COSYVOICE_VENDOR=tts/cosyvoice
CASTING_VOICES_DIR=tts/voices
```

Reference voices currently use paired files named by `server/camera_lab_server.py`, for example:

```text
tts/voices/laodao_en_ref.wav
tts/voices/laodao_en_ref.txt
tts/voices/xiaomei_en_ref.wav
tts/voices/xiaomei_en_ref.txt
```
