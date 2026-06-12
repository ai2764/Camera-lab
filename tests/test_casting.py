import json
import tempfile
import unittest
import wave
from pathlib import Path

from scripts import casting_tts
from server import camera_lab_server as server


class CastingJsonExtractionTests(unittest.TestCase):
    def test_extract_json_object_reads_fenced_json_with_surrounding_text(self):
        content = 'Before\n```json\n{"lines":[{"text":"Hello","voice":"laodao","emotion":"warm"}]}\n```\nAfter'

        data = server.extract_json_object(content)

        self.assertEqual(data["lines"][0]["text"], "Hello")
        self.assertEqual(data["lines"][0]["voice"], "laodao")
        self.assertEqual(data["lines"][0]["emotion"], "warm")

    def test_extract_json_object_rejects_messages_without_json_object(self):
        with self.assertRaises(RuntimeError):
            server.extract_json_object("I found two speakers but no machine-readable JSON.")


class CastingAnalysisTests(unittest.TestCase):
    def test_normalize_llm_url_adds_openai_v1_path_for_host_root(self):
        self.assertEqual(
            server.normalize_llm_url("http://127.0.0.1:2345"),
            "http://127.0.0.1:2345/v1",
        )

    def test_llm_availability_probe_uses_short_timeout_for_startup_health(self):
        original_urlopen = server.urllib.request.urlopen
        seen = {}

        def fake_urlopen(_request, timeout=0):
            seen["timeout"] = timeout
            raise TimeoutError("offline")

        server.urllib.request.urlopen = fake_urlopen
        try:
            ok, reason = server.llm_available()
        finally:
            server.urllib.request.urlopen = original_urlopen

        self.assertFalse(ok)
        self.assertIn("LLM not reachable", reason)
        self.assertLessEqual(seen["timeout"], 1.0)
        self.assertEqual(
            server.normalize_llm_url("http://127.0.0.1:2345/v1/"),
            "http://127.0.0.1:2345/v1",
        )

    def test_build_casting_prompt_requests_short_lines_and_emotions_without_voice_selection(self):
        prompt = server.build_casting_prompt("The lady says, \"Run before it sees us.\"", [])

        self.assertIn('"lines":[{"text":"...","emotion":"<emotion>"}]', prompt)
        self.assertIn("Break long dialogue into short TTS-friendly phrases", prompt)
        self.assertNotIn("voice", prompt.lower())
        self.assertNotIn("speaker", prompt.lower())

    def test_build_casting_prompt_keeps_quoted_dialogue_together_when_possible(self):
        prompt = server.build_casting_prompt("The lady says, \"Run before it sees us. I cannot hold the door much longer.\"", [])

        self.assertIn("Keep the content inside one pair of quotation marks as one line when possible", prompt)
        self.assertIn("Do not split quoted dialogue only because it contains punctuation", prompt)

    def test_build_casting_prompt_discourages_overusing_neutral_emotion(self):
        prompt = server.build_casting_prompt("She whispers, \"Please don't leave.\" He shouts, \"Get out!\"", [])

        self.assertIn("Neutral is only for emotionally flat or factual speech", prompt)
        self.assertIn("Infer emotion from nearby stage directions", prompt)
        self.assertIn("whispers -> whisper", prompt)
        self.assertIn("shouts/yells -> angry or excited", prompt)

    def test_analyze_casting_script_returns_text_and_emotion_only(self):
        original_llm_chat = server.llm_chat
        original_roster = server.casting_voice_roster
        server.casting_voice_roster = lambda: []
        server.llm_chat = lambda *_args, **_kwargs: (
            '{"lines":[{"text":"Run before it sees us.","voice":"xiaomei","emotion":"excited"}]}'
        )

        try:
            result = server.analyze_casting_script("The lady says, \"Run before it sees us.\"")
        finally:
            server.llm_chat = original_llm_chat
            server.casting_voice_roster = original_roster

        self.assertEqual(result, {"lines": [{"text": "Run before it sees us.", "emotion": "excited"}]})


class CastingPathDefaultsTests(unittest.TestCase):
    def test_repo_defaults_keep_tts_assets_and_library_under_tts_directory(self):
        self.assertEqual(server.COSYVOICE_MODEL_DIR, server.ROOT / "tts" / "models" / "Fun-CosyVoice3-0.5B")
        self.assertEqual(server.COSYVOICE_VENDOR, server.ROOT / "tts" / "cosyvoice")
        self.assertEqual(server.CASTING_VOICES_DIR, server.ROOT / "tts" / "voices")
        self.assertEqual(server.CASTING_LIBRARY_DIR, server.ROOT / "tts" / "library")
        self.assertNotIn("tasks", server.CASTING_LIBRARY_DIR.parts)
        self.assertNotIn("audiobook", str(server.COSYVOICE_VENDOR).lower())

    def test_tts_env_paths_are_resolved_relative_to_repo_root(self):
        absolute = (Path(tempfile.gettempdir()).resolve() / "cosyvoice")
        self.assertEqual(server.tts_env_path("tts/cosyvoice"), server.ROOT / "tts" / "cosyvoice")
        self.assertEqual(server.tts_env_path(absolute), absolute)

    def test_executable_available_accepts_commands_on_path(self):
        self.assertTrue(server.executable_available("python", resolver=lambda _name: "/usr/bin/python"))
        self.assertFalse(server.executable_available("missing-python", resolver=lambda _name: None))


class CastingSlugTests(unittest.TestCase):
    def test_casting_clip_slug_uses_first_words_and_deduplicates(self):
        used: set[str] = set()

        first = server.casting_clip_slug("Stay with me, don't look back!", used)
        second = server.casting_clip_slug("Stay with me, don't look back!", used)

        self.assertEqual(first, "stay_with_me_don't_look")
        self.assertRegex(second, r"^stay_with_me_don't_look_\d{4}$")
        self.assertIn(first, used)
        self.assertIn(second, used)

    def test_casting_clip_slug_uses_chinese_dialogue_prefix(self):
        used: set[str] = set()

        name = server.casting_clip_slug("别回头，我就在你身后。", used)

        self.assertEqual(name, "别回头_我就在你身后")


class CastingDirectiveTests(unittest.TestCase):
    def test_build_directive_wraps_cv2_with_endofprompt_only(self):
        directive = casting_tts.build_directive("Please speak softly.", "cv2")

        self.assertEqual(directive, "Please speak softly.<|endofprompt|>")

    def test_build_directive_wraps_cv3_with_assistant_preamble(self):
        directive = casting_tts.build_directive("Please speak softly.", "cv3")

        self.assertEqual(directive, "You are a helpful assistant. Please speak softly.<|endofprompt|>")

    def test_build_directive_does_not_double_wrap_existing_endofprompt(self):
        directive = casting_tts.build_directive("Already wrapped.<|endofprompt|>", "cv3")

        self.assertEqual(directive, "Already wrapped.<|endofprompt|>")

    def test_clamp_speed_keeps_tts_speed_in_safe_range(self):
        self.assertEqual(casting_tts.clamp_speed("0.2"), 0.6)
        self.assertEqual(casting_tts.clamp_speed("1.2"), 1.2)
        self.assertEqual(casting_tts.clamp_speed("9"), 1.4)
        self.assertEqual(casting_tts.clamp_speed("bad"), 1.0)


class CastingTtsJobTests(unittest.TestCase):
    def test_save_custom_casting_voice_writes_reference_files_and_roster_reads_them(self):
        original_voices_dir = server.CASTING_VOICES_DIR
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_VOICES_DIR = Path(tmp)
            try:
                saved = server.save_custom_casting_voice(
                    "My Hero Voice",
                    "hero sample.wav",
                    b"RIFFfakewav",
                    "This is my reference line.",
                )
                roster = server.casting_voice_roster()
            finally:
                server.CASTING_VOICES_DIR = original_voices_dir

        self.assertEqual(saved["id"], "custom_my_hero_voice")
        self.assertEqual(saved["label"], "My Hero Voice")
        self.assertTrue(saved["ref_wav"].endswith("custom_my_hero_voice.wav"))
        self.assertTrue(saved["ref_txt"].endswith("custom_my_hero_voice.txt"))
        self.assertEqual(roster[-1]["id"], "custom_my_hero_voice")
        self.assertEqual(roster[-1]["label"], "My Hero Voice")
        self.assertEqual(roster[-1]["ref_text"], "This is my reference line.")

    def test_save_custom_casting_voice_deduplicates_names(self):
        original_voices_dir = server.CASTING_VOICES_DIR
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_VOICES_DIR = Path(tmp)
            try:
                first = server.save_custom_casting_voice("Hero", "one.wav", b"one", "one")
                second = server.save_custom_casting_voice("Hero", "two.wav", b"two", "two")
            finally:
                server.CASTING_VOICES_DIR = original_voices_dir

        self.assertEqual(first["id"], "custom_hero")
        self.assertRegex(second["id"], r"^custom_hero_\d{4}$")

    def test_prepare_casting_tts_job_requires_explicit_voice(self):
        roster = {
            "laodao": {"id": "laodao", "ref_wav": "laodao.wav", "ref_text": "hello"},
            "xiaomei": {"id": "xiaomei", "ref_wav": "xiaomei.wav", "ref_text": "hello"},
        }

        with self.assertRaisesRegex(ValueError, "voice is required"):
            server.prepare_casting_tts_job([{"text": "Run.", "emotion": "excited"}], roster)

    def test_prepare_casting_tts_job_preserves_user_selected_voice(self):
        roster = {
            "laodao": {"id": "laodao", "ref_wav": "laodao.wav", "ref_text": "hello"},
            "xiaomei": {"id": "xiaomei", "ref_wav": "xiaomei.wav", "ref_text": "hello"},
        }

        job_lines, clips = server.prepare_casting_tts_job(
            [{"text": "Run.", "voice": "xiaomei", "emotion": "excited", "speed": 0.85}],
            roster,
        )

        self.assertEqual(job_lines[0]["voice"], "xiaomei")
        self.assertEqual(job_lines[0]["speed"], 0.85)
        self.assertEqual(clips[0]["voice"], "xiaomei")
        self.assertEqual(clips[0]["speed"], 0.85)

    def test_prepare_casting_tts_job_clamps_speed(self):
        roster = {"xiaomei": {"id": "xiaomei", "ref_wav": "xiaomei.wav", "ref_text": "hello"}}

        slow_job, _ = server.prepare_casting_tts_job(
            [{"text": "Slow.", "voice": "xiaomei", "emotion": "neutral", "speed": 0.1}],
            roster,
        )
        fast_job, _ = server.prepare_casting_tts_job(
            [{"text": "Fast.", "voice": "xiaomei", "emotion": "neutral", "speed": 5}],
            roster,
        )

        self.assertEqual(slow_job[0]["speed"], 0.6)
        self.assertEqual(fast_job[0]["speed"], 1.4)

    def test_prepare_casting_tts_job_archives_entire_library_for_generate_all(self):
        roster = {"xiaomei": {"id": "xiaomei", "ref_wav": "xiaomei.wav", "ref_text": "hello"}}
        original_library = server.CASTING_LIBRARY_DIR
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_LIBRARY_DIR = Path(tmp)
            current_dir = server.CASTING_LIBRARY_DIR / "current"
            current_dir.mkdir()
            existing_wav = current_dir / "run.wav"
            existing_json = current_dir / "run.json"
            unrelated_wav = current_dir / "old_line.wav"
            unrelated_json = current_dir / "old_line.json"
            existing_wav.write_bytes(b"old wav")
            existing_json.write_text('{"old": true}', encoding="utf-8")
            unrelated_wav.write_bytes(b"unrelated wav")
            unrelated_json.write_text('{"old": "unrelated"}', encoding="utf-8")

            try:
                job_lines, clips = server.prepare_casting_tts_job(
                    [{"text": "Run.", "voice": "xiaomei", "emotion": "excited"}],
                    roster,
                    archive_all=True,
                )
            finally:
                server.CASTING_LIBRARY_DIR = original_library

            archive_dirs = [path for path in (Path(tmp) / "archive").iterdir() if path.is_dir()]
            archived_names = sorted(path.name for path in archive_dirs[0].iterdir()) if archive_dirs else []

        self.assertEqual(job_lines[0]["out_name"], "run")
        self.assertEqual(clips[0]["name"], "run")
        self.assertFalse(existing_wav.exists())
        self.assertFalse(existing_json.exists())
        self.assertFalse(unrelated_wav.exists())
        self.assertFalse(unrelated_json.exists())
        self.assertEqual(len(archive_dirs), 1)
        self.assertRegex(archive_dirs[0].name, r"^\d{8}_\d{6}(?:_\d{4})?$")
        self.assertEqual(archived_names, ["old_line.json", "old_line.wav", "run.json", "run.wav"])

    def test_open_casting_archive_folder_creates_archive_dir_and_calls_opener(self):
        original_library = server.CASTING_LIBRARY_DIR
        opened: list[Path] = []
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_LIBRARY_DIR = Path(tmp)

            try:
                result = server.open_casting_archive_folder(lambda path: opened.append(path))
                exists = (Path(tmp) / "archive").exists()
            finally:
                server.CASTING_LIBRARY_DIR = original_library

        self.assertEqual(opened, [Path(tmp) / "archive"])
        self.assertEqual(result, {"ok": True, "path": str(Path(tmp) / "archive")})
        self.assertTrue(exists)

    def test_casting_library_clips_migrates_legacy_root_files_to_current(self):
        original_library = server.CASTING_LIBRARY_DIR
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_LIBRARY_DIR = Path(tmp)
            legacy_wav = Path(tmp) / "legacy.wav"
            legacy_json = Path(tmp) / "legacy.json"
            legacy_wav.write_bytes(b"legacy")
            legacy_json.write_text('{"text":"Legacy","voice":"voice_a","emotion":"warm"}', encoding="utf-8")

            try:
                clips = server.casting_library_clips()
                moved_wav = Path(tmp) / "current" / "legacy.wav"
                moved_json = Path(tmp) / "current" / "legacy.json"
            finally:
                server.CASTING_LIBRARY_DIR = original_library

            self.assertFalse(legacy_wav.exists())
            self.assertFalse(legacy_json.exists())
            self.assertTrue(moved_wav.exists())
            self.assertTrue(moved_json.exists())

        self.assertEqual(clips[0]["name"], "legacy")
        self.assertEqual(clips[0]["text"], "Legacy")

    def test_trim_casting_clip_archives_original_and_replaces_current_wav(self):
        original_library = server.CASTING_LIBRARY_DIR
        commands: list[list[str]] = []
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_LIBRARY_DIR = Path(tmp)
            current = Path(tmp) / "current"
            current.mkdir()
            wav = current / "line.wav"
            meta = current / "line.json"
            wav.write_bytes(b"old wav")
            meta.write_text('{"text":"Line","voice":"voice_a","emotion":"neutral"}', encoding="utf-8")

            def fake_runner(cmd, **_kwargs):
                commands.append([str(part) for part in cmd])
                Path(cmd[-1]).write_bytes(b"trimmed wav")
                return None

            try:
                result = server.trim_casting_clip(str(wav), 0.25, 1.75, runner=fake_runner)
                archive_dirs = [path for path in (Path(tmp) / "archive").iterdir() if path.is_dir()]
                archived_names = sorted(path.name for path in archive_dirs[0].iterdir()) if archive_dirs else []
                updated_meta = json.loads(meta.read_text(encoding="utf-8"))
                trimmed_bytes = wav.read_bytes()
            finally:
                server.CASTING_LIBRARY_DIR = original_library

        self.assertEqual(result["file"], str(wav))
        self.assertEqual(trimmed_bytes, b"trimmed wav")
        self.assertEqual(len(commands), 1)
        self.assertIn("-ss", commands[0])
        self.assertIn("0.25", commands[0])
        self.assertIn("-to", commands[0])
        self.assertIn("1.75", commands[0])
        self.assertEqual(archived_names, ["line.json", "line.wav"])
        self.assertEqual(updated_meta["trim_start"], 0.25)
        self.assertEqual(updated_meta["trim_end"], 1.75)

    def test_trim_casting_clip_rejects_non_current_library_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside.wav"
            outside.write_bytes(b"wav")

            with self.assertRaises(PermissionError):
                server.trim_casting_clip(str(outside), 0, 1, runner=lambda *_args, **_kwargs: None)

    def test_recycle_casting_clip_moves_wav_and_meta_to_recycle_bin(self):
        original_library = server.CASTING_LIBRARY_DIR
        recycled: list[Path] = []
        with tempfile.TemporaryDirectory() as tmp:
            server.CASTING_LIBRARY_DIR = Path(tmp)
            current = Path(tmp) / "current"
            current.mkdir()
            wav = current / "line.wav"
            meta = current / "line.json"
            wav.write_bytes(b"wav")
            meta.write_text('{"text":"Line"}', encoding="utf-8")

            def fake_recycler(path: Path):
                recycled.append(path)
                path.unlink()

            try:
                result = server.recycle_casting_clip(str(wav), recycler=fake_recycler)
            finally:
                server.CASTING_LIBRARY_DIR = original_library

        self.assertEqual([path.name for path in recycled], ["line.wav", "line.json"])
        self.assertEqual(result["recycled"], [str(wav), str(meta)])
        self.assertEqual(result["clips"], [])

    def test_recycle_casting_clip_rejects_non_current_library_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            outside = Path(tmp) / "outside.wav"
            outside.write_bytes(b"wav")

            with self.assertRaises(PermissionError):
                server.recycle_casting_clip(str(outside), recycler=lambda _path: None)


class DirectorTimelineAudioTests(unittest.TestCase):
    def test_director_timeline_audio_segments_copy_audio_and_use_shot_frame_math(self):
        original_input = server.COMFY_INPUT
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            server.COMFY_INPUT = tmp_path / "comfy_input"
            first_audio = tmp_path / "first line.wav"
            second_audio = tmp_path / "second-line.wav"
            first_audio.write_bytes(b"first")
            second_audio.write_bytes(b"second")
            run = {"run_id": "dryrun"}
            timeline = {
                "segments": [
                    {"audio_path": str(first_audio), "start_frame": 0, "frames": 36},
                    {"audio_path": "", "start_frame": 36, "frames": 12},
                    {"audio_path": str(second_audio), "start_frame": 48, "frames": 72},
                ]
            }

            try:
                segments = server.director_timeline_audio_segments(run, timeline)
                first_copied = (server.COMFY_INPUT / "dryrun_segaudio_01_first line.wav").read_bytes()
                second_copied = (server.COMFY_INPUT / "dryrun_segaudio_03_second-line.wav").read_bytes()
            finally:
                server.COMFY_INPUT = original_input

        self.assertEqual(
            segments,
            [
                {
                    "audioFile": "dryrun_segaudio_01_first line.wav",
                    "fileName": "first line.wav",
                    "start": 0,
                    "length": 36,
                    "trimStart": 0,
                },
                {
                    "audioFile": "dryrun_segaudio_03_second-line.wav",
                    "fileName": "second-line.wav",
                    "start": 48,
                    "length": 72,
                    "trimStart": 0,
                },
            ],
        )
        self.assertEqual(first_copied, b"first")
        self.assertEqual(second_copied, b"second")

    def test_director_timeline_audio_segments_do_not_merge_shared_source_audio(self):
        original_input = server.COMFY_INPUT
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            server.COMFY_INPUT = tmp_path / "comfy_input"
            shared_audio = tmp_path / "shared.wav"
            shared_audio.write_bytes(b"shared")
            run = {"run_id": "dryrun"}
            timeline = {
                "segments": [
                    {"audio_path": str(shared_audio), "start_frame": 0, "frames": 48},
                    {"audio_path": str(shared_audio), "start_frame": 48, "frames": 24},
                ]
            }

            try:
                segments = server.director_timeline_audio_segments(run, timeline)
            finally:
                server.COMFY_INPUT = original_input

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["audioFile"], "dryrun_segaudio_01_shared.wav")
        self.assertEqual(segments[0]["start"], 0)
        self.assertEqual(segments[0]["length"], 48)
        self.assertEqual(segments[1]["audioFile"], "dryrun_segaudio_02_shared.wav")
        self.assertEqual(segments[1]["start"], 48)
        self.assertEqual(segments[1]["length"], 24)

    def test_director_timeline_audio_segments_reject_missing_audio_file(self):
        original_input = server.COMFY_INPUT
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            server.COMFY_INPUT = tmp_path / "comfy_input"
            missing_audio = tmp_path / "missing.wav"
            run = {"run_id": "dryrun"}
            timeline = {
                "audio_segments": [
                    {"audio_path": str(missing_audio), "start": 0, "length": 24, "trimStart": 0},
                ],
                "segments": [],
            }

            try:
                with self.assertRaises(FileNotFoundError):
                    server.director_timeline_audio_segments(run, timeline)
            finally:
                server.COMFY_INPUT = original_input

    def test_wav_duration_seconds_reads_library_clip_duration(self):
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / "line.wav"
            with wave.open(str(wav_path), "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                wav.writeframes(b"\0\0" * 36000)

            self.assertEqual(server.wav_duration_seconds(wav_path), 1.5)


if __name__ == "__main__":
    unittest.main()
