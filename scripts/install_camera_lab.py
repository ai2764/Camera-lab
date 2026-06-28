from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from camera_lab_common import (
    ENV_EXAMPLE_PATH,
    ENV_PATH,
    REPO_ROOT,
    comfy_root_from_env,
    comfy_url_from_env,
    http_json,
    install_workflows,
    load_env,
    python_executable,
)
from camera_lab_setup.hardware import detect_hardware
from camera_lab_setup.modules import MODULES, CameraLabModule, ModelProfile, ModelRef, module_ids, selected_modules
from camera_lab_setup.visibility import ComfyVisibility, model_visible, visibility_from_object_info


DEFAULT_STORAGE_HEADROOM_GB = 20.0


@dataclass(frozen=True)
class StoragePlan:
    profiles: tuple[ModelProfile, ...]
    required_gb: float
    headroom_gb: float
    available_gb: float | None
    target_label: str

    @property
    def required_with_headroom_gb(self) -> float:
        return self.required_gb + self.headroom_gb

    @property
    def ok(self) -> bool:
        return self.available_gb is None or self.available_gb >= self.required_with_headroom_gb


@dataclass(frozen=True)
class DownloadCandidate:
    model: ModelRef
    url: str
    target: Path


@dataclass(frozen=True)
class MissingDownloadPlan:
    downloadable: tuple[DownloadCandidate, ...]
    manual: tuple[ModelRef, ...]


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def parse_modules(raw: str | None, all_modules: bool) -> list[str] | None:
    if all_modules:
        return module_ids()
    if not raw:
        return None
    return [item.strip() for item in raw.split(",") if item.strip()]


def profile_is_present(profile: ModelProfile, models_root: Path | None = None, visibility: ComfyVisibility | None = None) -> bool:
    if not profile.required_models:
        return False
    return all(
        (visibility is not None and model_visible(visibility, model))
        or (models_root is not None and model_target_path(models_root, model).exists())
        for model in profile.required_models
    )


def drop_in_profiles(
    modules: list[CameraLabModule],
    models_root: Path | None = None,
    visibility: ComfyVisibility | None = None,
) -> tuple[ModelProfile, ...]:
    profiles: list[ModelProfile] = []
    for module in modules:
        for profile in module.model_profiles:
            if profile.compatibility != "drop_in" or profile.disk_gb <= 0 or not profile.required_models:
                continue
            if profile_is_present(profile, models_root=models_root, visibility=visibility):
                continue
            profiles.append(profile)
    return tuple(profiles)


def build_storage_plan(
    modules: list[CameraLabModule],
    *,
    models_root: Path | None = None,
    visibility: ComfyVisibility | None = None,
    available_gb: float | None = None,
    headroom_gb: float = DEFAULT_STORAGE_HEADROOM_GB,
    target_label: str = "ComfyUI models drive",
) -> StoragePlan:
    profiles = drop_in_profiles(modules, models_root=models_root, visibility=visibility)
    required_gb = sum(profile.disk_gb for profile in profiles)
    return StoragePlan(
        profiles=profiles,
        required_gb=required_gb,
        headroom_gb=headroom_gb,
        available_gb=available_gb,
        target_label=target_label,
    )


def check_storage(
    modules: list[CameraLabModule],
    hardware,
    *,
    models_root: Path | None = None,
    visibility: ComfyVisibility | None = None,
    headroom_gb: float = DEFAULT_STORAGE_HEADROOM_GB,
) -> StoragePlan:
    if hardware.comfy_free_gb is not None:
        return build_storage_plan(
            modules,
            models_root=models_root,
            visibility=visibility,
            available_gb=hardware.comfy_free_gb,
            headroom_gb=headroom_gb,
            target_label="ComfyUI models drive",
        )
    return build_storage_plan(
        modules,
        models_root=models_root,
        visibility=visibility,
        available_gb=hardware.repo_free_gb,
        headroom_gb=headroom_gb,
        target_label="repo drive",
    )


def _profile_vram(profile: ModelProfile) -> str:
    if profile.min_vram_gb is None and profile.recommended_vram_gb is None:
        return "VRAM: any"
    if profile.min_vram_gb is None:
        return f"VRAM: recommended {profile.recommended_vram_gb:g} GiB"
    if profile.recommended_vram_gb is None:
        return f"VRAM: min {profile.min_vram_gb:g} GiB"
    return f"VRAM: min {profile.min_vram_gb:g} GiB, recommended {profile.recommended_vram_gb:g} GiB"


def print_profile_plan(modules: list[CameraLabModule]) -> None:
    print("Model profiles:")
    for module in modules:
        print(f"  {module.id}: {module.label}")
        if not module.model_profiles:
            print("    - no model profile required")
            continue
        for profile in module.model_profiles:
            details = [
                f"compatibility={profile.compatibility}",
                _profile_vram(profile),
            ]
            if profile.quantization:
                details.append(f"quantization={profile.quantization}")
            if profile.size:
                details.append(f"size={profile.size}")
            if profile.disk_gb:
                details.append(f"disk~{profile.disk_gb:g} GB")
            print(f"    - {profile.id}: {profile.label} ({'; '.join(details)})")
            if profile.notes:
                print(f"      {profile.notes}")


def print_storage_plan(plan: StoragePlan) -> None:
    available = "unknown" if plan.available_gb is None else f"{plan.available_gb:g} GB"
    status = "OK" if plan.ok else "LOW SPACE"
    print("Storage:")
    print(f"  Target: {plan.target_label}")
    print(f"  Free: {available}")
    print(f"  Selected drop-in profiles need about: {plan.required_gb:g} GB")
    print(f"  Recommended headroom: {plan.headroom_gb:g} GB")
    print(f"  Status: {status}")
    if not plan.ok:
        for profile in plan.profiles:
            print(f"  - {profile.id} needs about {profile.disk_gb:g} GB")


def load_comfy_visibility() -> ComfyVisibility | None:
    try:
        return visibility_from_object_info(http_json(f"{comfy_url_from_env()}/object_info", timeout=30.0))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"Warning: ComfyUI object_info unavailable for model visibility check: {exc}", file=sys.stderr)
        return None


def model_target_path(models_root: Path, model: ModelRef) -> Path:
    return models_root / model.folder / Path(model.name)


def missing_downloadable_models(
    profiles: list[ModelProfile] | tuple[ModelProfile, ...],
    models_root: Path,
    visibility: ComfyVisibility | None = None,
) -> MissingDownloadPlan:
    downloadable: list[DownloadCandidate] = []
    manual: list[ModelRef] = []
    seen: set[tuple[str, str]] = set()
    for profile in profiles:
        for model in profile.required_models:
            key = (model.folder, model.name)
            if key in seen:
                continue
            seen.add(key)
            target = model_target_path(models_root, model)
            if target.exists() or (visibility is not None and model_visible(visibility, model)):
                continue
            if model.source_url:
                downloadable.append(DownloadCandidate(model=model, url=model.source_url, target=target))
            else:
                manual.append(model)
    return MissingDownloadPlan(downloadable=tuple(downloadable), manual=tuple(manual))


def download_file(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.part")
    with urllib.request.urlopen(url) as response, tmp.open("wb") as output:
        shutil.copyfileobj(response, output)
    tmp.replace(target)


def download_models(candidates: tuple[DownloadCandidate, ...]) -> None:
    for index, candidate in enumerate(candidates, start=1):
        print(f"Downloading model {index}/{len(candidates)}: {candidate.model.name}")
        download_file(candidate.url, candidate.target)
        print(f"Installed model: {candidate.target}")


def ask_yes_no(prompt: str, *, assume_yes: bool = False) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print("Non-interactive terminal detected. Skipping model download prompt.")
        return False
    answer = input(f"{prompt} [y/N] ").strip().lower()
    return answer in {"y", "yes"}


def maybe_download_models(
    modules: list[CameraLabModule],
    comfy_root: Path | None,
    *,
    visibility: ComfyVisibility | None = None,
    assume_yes: bool = False,
    skip_model_download: bool = False,
) -> None:
    if skip_model_download:
        return
    if not comfy_root or not comfy_root.exists():
        print("COMFYUI_ROOT is not configured. Skipping model download prompt.", file=sys.stderr)
        return
    profiles = drop_in_profiles(modules, models_root=comfy_root / "models", visibility=visibility)
    plan = missing_downloadable_models(profiles, comfy_root / "models", visibility=visibility)
    if plan.manual:
        print("Missing models without registered download URLs:")
        for model in plan.manual:
            print(f"  - {model.folder}/{model.name}")
    if not plan.downloadable:
        print("No registered model downloads are pending.")
        return
    print("Downloadable missing models:")
    for candidate in plan.downloadable:
        print(f"  - {candidate.model.folder}/{candidate.model.name}")
    if ask_yes_no("Download these models now? The installer will wait until downloads complete.", assume_yes=assume_yes):
        download_models(plan.downloadable)


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Camera Lab with optional modules.")
    parser.add_argument("--list-modules", action="store_true", help="List installable modules and exit.")
    parser.add_argument("--list-profiles", action="store_true", help="List workflow-compatible model profiles and exit.")
    parser.add_argument("--modules", help="Comma-separated module ids to install.")
    parser.add_argument("--all", action="store_true", help="Install all modules.")
    parser.add_argument("--skip-node", action="store_true", help="Skip npm install.")
    parser.add_argument("--install-playwright-browser", action="store_true", help="Install Playwright Chromium.")
    parser.add_argument("--skip-workflow-install", action="store_true", help="Do not install workflows into ComfyUI.")
    parser.add_argument("--skip-model-download", action="store_true", help="Do not prompt to download missing registered models.")
    parser.add_argument("--yes", action="store_true", help="Answer yes to installer prompts.")
    args = parser.parse_args()

    if args.list_modules:
        for module in MODULES:
            print(f"{module.id}: {module.label} - {module.description}")
        return 0

    selected = parse_modules(args.modules, args.all)
    modules_for_install = selected_modules(selected)

    if args.list_profiles:
        print_profile_plan(modules_for_install)
        return 0

    if not ENV_PATH.exists():
        if not ENV_EXAMPLE_PATH.exists():
            print(".env.example is missing.", file=sys.stderr)
            return 1
        shutil.copy2(ENV_EXAMPLE_PATH, ENV_PATH)
        print("Created .env from .env.example. Edit COMFYUI_ROOT before running setup checks.")

    load_env()
    comfy_root = comfy_root_from_env()
    hardware = detect_hardware(repo_root=REPO_ROOT, comfy_root=comfy_root_from_env())
    print(
        f"Hardware: GPU={hardware.gpu_name or 'unknown'}, "
        f"VRAM={hardware.vram_gb or 'unknown'} GiB, OS={hardware.os_name}, Python={hardware.python_version}"
    )
    for warning in hardware.warnings:
        print(f"Warning: {warning}", file=sys.stderr)
    print_profile_plan(modules_for_install)
    storage_plan = check_storage(
        modules_for_install,
        hardware,
        models_root=(comfy_root / "models") if comfy_root and comfy_root.exists() else None,
        visibility=load_comfy_visibility(),
    )
    print_storage_plan(storage_plan)
    if not storage_plan.ok:
        print(
            f"Not enough free space for selected drop-in model profiles on {storage_plan.target_label}.",
            file=sys.stderr,
        )
        return 1

    print("Installing Python dependencies...")
    run([python_executable(), "-m", "pip", "install", "-r", "requirements.txt"])

    if not args.skip_node and (REPO_ROOT / "package.json").exists():
        npm = shutil.which("npm")
        if npm:
            print("Installing Node dependencies...")
            run([npm, "install"])
            if args.install_playwright_browser:
                npx = shutil.which("npx")
                if npx:
                    run([npx, "playwright", "install", "chromium"])
                else:
                    print("npx was not found. Skipping Playwright browser install.", file=sys.stderr)
        else:
            print("npm was not found. Skipping Node dependencies.", file=sys.stderr)

    if not args.skip_workflow_install and comfy_root and comfy_root.exists():
        install_workflows(module_ids=selected)
    elif not args.skip_workflow_install:
        print("COMFYUI_ROOT is not configured or does not exist. Skipping workflow install.", file=sys.stderr)
    maybe_download_models(
        modules_for_install,
        comfy_root,
        visibility=load_comfy_visibility(),
        assume_yes=args.yes,
        skip_model_download=args.skip_model_download,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
