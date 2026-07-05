"""Camera Lab launcher: assess hardware, recommend, and start a deployment mode."""
from __future__ import annotations

MODES = ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker")


def recommended_mode(has_comfy: bool, want_docker: bool) -> str:
    if has_comfy and not want_docker:
        return "no-docker"
    if has_comfy and want_docker:
        return "cam-lab-only-docker"
    if not has_comfy and want_docker:
        return "full-docker"
    return "none"


def feasibility_for(min_vram_gb, recommended_vram_gb, vram_gb) -> str:
    if min_vram_gb is None and recommended_vram_gb is None:
        return "any"
    if vram_gb is None:
        return "vram-unknown"
    if min_vram_gb is not None and vram_gb < min_vram_gb:
        return "insufficient"
    if recommended_vram_gb is not None and vram_gb < recommended_vram_gb:
        return "tight"
    return "fits"


def mode_command(mode: str) -> list[list[str]]:
    native = ["python", "scripts/start_camera_lab.py", "--open"]
    if mode == "no-docker":
        return [native]
    if mode == "full-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "--env-file",
                "docker/compose.env",
                "up",
                "-d",
                "--build",
            ]
        ]
    if mode == "cam-lab-only-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.camera-lab-only.yml",
                "--env-file",
                "docker/compose.camera-lab-only.env",
                "up",
                "-d",
                "--build",
            ]
        ]
    if mode == "comfy-only-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.comfy-only.yml",
                "--env-file",
                "docker/compose.comfy-only.env",
                "up",
                "-d",
                "--build",
            ],
            native,
        ]
    raise ValueError(f"unknown mode: {mode}")
