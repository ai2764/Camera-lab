from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .hardware import HardwareProfile
from .modules import CameraLabModule, ModelProfile
from .visibility import ComfyVisibility, model_visible, node_visible


@dataclass(frozen=True)
class ModuleStatus:
    id: str
    label: str
    enabled: bool
    ready: bool
    profile: str | None
    recommendation: str
    missing: tuple[str, ...]
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "enabled": self.enabled,
            "ready": self.ready,
            "profile": self.profile,
            "recommendation": self.recommendation,
            "missing": list(self.missing),
            "warnings": list(self.warnings),
        }


def _profile_missing(module: CameraLabModule, profile: ModelProfile, visibility: ComfyVisibility) -> tuple[str, ...]:
    missing: list[str] = []
    for node_name in (*module.required_nodes, *profile.required_nodes):
        if not node_visible(visibility, node_name):
            missing.append(node_name)
    for model in profile.required_models:
        if not model_visible(visibility, model):
            missing.append(model.name)
    return tuple(missing)


def _hardware_recommendation(profile: ModelProfile, hardware: HardwareProfile, ready: bool) -> tuple[str, tuple[str, ...]]:
    if not ready:
        return "available-with-downloads", ()
    if hardware.vram_gb is not None and profile.min_vram_gb is not None and hardware.vram_gb < profile.min_vram_gb:
        return (
            "risky",
            (
                f"{hardware.vram_gb} GiB VRAM detected; "
                f"{profile.label} is expected to need at least {profile.min_vram_gb:g} GiB.",
            ),
        )
    return "recommended", ()


def resolve_module(
    module: CameraLabModule,
    hardware: HardwareProfile,
    visibility: ComfyVisibility,
    enabled: bool = True,
) -> ModuleStatus:
    if not enabled:
        return ModuleStatus(module.id, module.label, False, False, None, "disabled", (), ())

    if not module.model_profiles:
        missing = tuple(node for node in module.required_nodes if not node_visible(visibility, node))
        recommendation = "recommended" if not missing else "unavailable"
        return ModuleStatus(module.id, module.label, True, not missing, None, recommendation, missing, ())

    candidates = [(profile, _profile_missing(module, profile, visibility)) for profile in module.model_profiles]
    ready_candidates = [(profile, missing) for profile, missing in candidates if not missing]
    if ready_candidates:
        profile, missing = ready_candidates[-1]
    else:
        profile, missing = min(candidates, key=lambda item: len(item[1]))

    ready = not missing
    recommendation, warnings = _hardware_recommendation(profile, hardware, ready)
    required_nodes = (*module.required_nodes, *profile.required_nodes)
    if missing and any(item in missing for item in required_nodes):
        recommendation = "unavailable"

    return ModuleStatus(module.id, module.label, True, ready, profile.id, recommendation, missing, warnings)


def resolve_modules(
    modules: Iterable[CameraLabModule],
    hardware: HardwareProfile,
    visibility: ComfyVisibility,
    enabled_ids: set[str] | None = None,
) -> dict[str, ModuleStatus]:
    return {
        module.id: resolve_module(module, hardware, visibility, enabled=(enabled_ids is None or module.id in enabled_ids))
        for module in modules
    }
