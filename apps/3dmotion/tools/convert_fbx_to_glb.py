import argparse
import sys
from pathlib import Path

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    passthrough = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser(description="Convert an FBX file to binary glTF (.glb).")
    parser.add_argument("--input", required=True, help="Source FBX path.")
    parser.add_argument("--output", required=True, help="Target GLB path.")
    parser.add_argument("--scale", type=float, default=1.0, help="Uniform scale applied after import.")
    return parser.parse_args(passthrough)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def convert(input_path: Path, output_path: Path, scale: float) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Input FBX not found: {input_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(input_path))

    if scale != 1.0:
        for obj in bpy.context.scene.objects:
            obj.scale = (obj.scale.x * scale, obj.scale.y * scale, obj.scale.z * scale)

    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_animations=True,
        export_skins=True,
        export_yup=True,
    )


def main() -> None:
    args = parse_args()
    convert(Path(args.input).resolve(), Path(args.output).resolve(), args.scale)


if __name__ == "__main__":
    main()
