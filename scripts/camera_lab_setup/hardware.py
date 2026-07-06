from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class HardwareProfile:
    gpu_name: str | None = None
    vram_gb: int | None = None
    ram_gb: int | None = None
    os_name: str = ""
    python_version: str = ""
    repo_free_gb: int | None = None
    comfy_free_gb: int | None = None
    cuda_available: bool | None = None
    warnings: tuple[str, ...] = field(default_factory=tuple)


def default_nvidia_smi() -> str:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return ""
    result = subprocess.run(
        [exe, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else ""


def parse_nvidia_smi(output: str) -> tuple[str | None, int | None]:
    first = next((line.strip() for line in output.splitlines() if line.strip()), "")
    if not first or "," not in first:
        return None, None
    name, raw_mb = [part.strip() for part in first.split(",", 1)]
    try:
        vram_gb = round(int(raw_mb) / 1024)
    except ValueError:
        vram_gb = None
    return name or None, vram_gb


def detect_hardware(
    *,
    nvidia_smi: Callable[[], str] | None = None,
    disk_usage: Callable[[str | Path], tuple[int, int, int]] | None = None,
    platform_name: str | None = None,
    python_version: str | None = None,
    repo_root: Path | None = None,
    comfy_root: Path | None = None,
) -> HardwareProfile:
    warnings: list[str] = []
    gpu_name, vram_gb = parse_nvidia_smi((nvidia_smi or default_nvidia_smi)())
    if vram_gb is None:
        warnings.append("GPU VRAM could not be detected")

    disk_usage = disk_usage or shutil.disk_usage
    repo_free_gb = None
    comfy_free_gb = None
    if repo_root:
        repo_free_gb = round(disk_usage(repo_root)[2] / (1024**3))
    if comfy_root:
        comfy_free_gb = round(disk_usage(comfy_root)[2] / (1024**3))

    return HardwareProfile(
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        os_name=platform_name or platform.system(),
        python_version=python_version or sys.version.split()[0],
        repo_free_gb=repo_free_gb,
        comfy_free_gb=comfy_free_gb,
        warnings=tuple(warnings),
    )
