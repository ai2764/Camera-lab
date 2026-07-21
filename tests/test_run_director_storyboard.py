from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import run_director_storyboard as runner  # noqa: E402


class RunDirectorStoryboardTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmpdir.name)
        self.img_a = self.tmpdir / "a.png"
        self.img_b = self.tmpdir / "b.png"
        Image.new("RGB", (64, 64), color=(20, 40, 60)).save(self.img_a)
        Image.new("RGB", (64, 64), color=(200, 100, 50)).save(self.img_b)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_normalize_storyboard_stages_images_and_builds_payload(self) -> None:
        storyboard_path = self.tmpdir / "board.json"
        data = {
            "global_prompt": "A continuous cinematic shot of the same woman in rain.",
            "negative_prompt": "blurry",
            "width": 768,
            "height": 512,
            "seed": 7,
            "segments": [
                {
                    "id": "s1",
                    "image": str(self.img_a),
                    "prompt": "first beat",
                    "start": 0,
                    "duration": 2.5,
                    "strength": 0.8,
                },
                {
                    "id": "s2",
                    "image": "b.png",
                    "prompt": "second beat",
                    "start": 2.5,
                    "duration": 3.5,
                    "strength": 0.7,
                },
            ],
        }
        storyboard_path.write_text(json.dumps(data), encoding="utf-8")

        normalized = runner.normalize_storyboard(data, storyboard_path=storyboard_path)
        self.assertEqual(normalized["global_prompt"], data["global_prompt"])
        self.assertEqual(normalized["duration"], 6.0)
        self.assertEqual(len(normalized["segments"]), 2)
        self.assertTrue(Path(normalized["segments"][0]["image_path"]).exists())
        self.assertTrue(Path(normalized["segments"][1]["image_path"]).exists())
        self.assertTrue(str(normalized["segments"][0]["image_path"]).startswith(str(runner.UPLOAD_STAGING)))

        payload = runner.build_run_payload(normalized)
        self.assertEqual(payload["workflow_id"], "ltx_director_2")
        self.assertEqual(payload["camera_move"], "director_ref")
        self.assertEqual(payload["global_prompt"], data["global_prompt"])
        self.assertEqual(payload["timeline_segments"][0]["prompt"], "first beat")
        self.assertEqual(payload["timeline_segments"][1]["duration"], 3.5)
        self.assertEqual(payload["duration"], 6.0)

    def test_cli_image_mode_sequential_starts(self) -> None:
        normalized = runner.storyboard_from_cli_images(
            images=[str(self.img_a), str(self.img_b)],
            prompts=["a", "b"],
            durations=[3.0, 4.0],
            starts=None,
            strengths=None,
            global_prompt="global",
            negative_prompt="neg",
            width=640,
            height=480,
            seed=None,
            default_duration=3.0,
            default_strength=0.8,
        )
        self.assertEqual(normalized["segments"][0]["start"], 0.0)
        self.assertEqual(normalized["segments"][1]["start"], 3.0)
        self.assertEqual(normalized["duration"], 7.0)
        self.assertEqual(normalized["width"], 640)

    def test_text_only_segment_allowed(self) -> None:
        normalized = runner.normalize_storyboard(
            {
                "global_prompt": "global",
                "segments": [
                    {"prompt": "bridge motion only", "start": 0, "duration": 2.0},
                    {"image": str(self.img_a), "prompt": "land", "start": 2.0, "duration": 2.0},
                ],
            }
        )
        self.assertEqual(normalized["segments"][0]["type"], "text")
        self.assertEqual(normalized["segments"][0]["image_path"], "")
        self.assertEqual(normalized["segments"][1]["type"], "image")

    def test_dry_run_main(self) -> None:
        board = self.tmpdir / "cli_board.json"
        board.write_text(
            json.dumps(
                {
                    "global_prompt": "global",
                    "segments": [
                        {
                            "image": str(self.img_a),
                            "prompt": "beat",
                            "duration": 2,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        code = runner.main(["--storyboard", str(board), "--dry-run"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
