import comfy.utils
import torch


class Text:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"default": "", "multiline": True})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("string",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/text"

    def run(self, text=""):
        return (text,)


class CRText(Text):
    RETURN_TYPES = ("*", "STRING")
    RETURN_NAMES = ("text", "show_help")
    CATEGORY = "workflow_compat/text"

    def run(self, text=""):
        return (text, "https://github.com/Suzie1/ComfyUI_Comfyroll_CustomNodes")


class Int:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647})}}

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/number"

    def run(self, value=0):
        return (int(value),)


class StringToInt:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"string": ("STRING", {"default": "0", "multiline": False})}}

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("INT",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/number"

    def run(self, string="0"):
        try:
            return (int(float(str(string).strip())),)
        except Exception:
            return (0,)


class TextList:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text_a": ("STRING", {"default": "", "forceInput": True}),
                "text_b": ("STRING", {"default": "", "forceInput": True}),
                "text_c": ("STRING", {"default": "", "forceInput": True}),
                "text_d": ("STRING", {"default": "", "forceInput": True}),
                "text_e": ("STRING", {"default": "", "forceInput": True}),
                "text_f": ("STRING", {"default": "", "forceInput": True}),
                "text_g": ("STRING", {"default": "", "forceInput": True}),
            },
        }

    RETURN_TYPES = ("LIST",)
    RETURN_NAMES = ("LIST",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/text"

    def run(self, **kwargs):
        keys = ("text_a", "text_b", "text_c", "text_d", "text_e", "text_f", "text_g")
        return ([str(kwargs.get(k, "")) for k in keys if kwargs.get(k, "") not in (None, "")],)


class TextListToString:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"text_list": ("*",)},
            "optional": {
                "prefix": ("STRING", {"default": "", "multiline": False}),
                "suffix": ("STRING", {"default": "", "multiline": False}),
                "separator": ("STRING", {"default": "\n", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/text"

    def run(self, text_list, prefix="", suffix="", separator="\n"):
        if isinstance(text_list, (list, tuple)):
            body = str(separator).join(str(x) for x in text_list)
        else:
            body = str(text_list)
        return (f"{prefix}{body}{suffix}",)


class ExtractLinesByIndex:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "input_text": ("STRING", {"default": "", "forceInput": True}),
                "delimiter": ("STRING", {"default": ",", "multiline": False}),
                "index": ("INT", {"default": 1, "min": 0, "max": 9999}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("STRING", "STRING", "STRING", "STRING", "STRING")
    FUNCTION = "run"
    CATEGORY = "workflow_compat/text"

    def run(self, input_text="", delimiter=",", index=1):
        delimiter = delimiter or "\n"
        parts = [p.strip() for p in str(input_text).split(delimiter)]
        start = max(int(index) - 1, 0)
        values = parts[start:start + 5]
        values += [""] * (5 - len(values))
        return tuple(values[:5])


class ResizeImageResolution:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "resolution": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "method": (["NEAREST", "BILINEAR", "BICUBIC", "LANCZOS"],),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/image"

    def run(self, image, resolution=1024, method="BICUBIC"):
        width = image.shape[2]
        height = image.shape[1]
        longest = max(width, height)
        if longest <= 0:
            return (image,)

        scale = float(resolution) / float(longest)
        new_width = max(1, round(width * scale))
        new_height = max(1, round(height * scale))
        upscale_method = str(method).lower()
        if upscale_method == "nearest":
            upscale_method = "nearest-exact"

        resized = image.movedim(-1, 1)
        resized = comfy.utils.common_upscale(resized, new_width, new_height, upscale_method, "disabled")
        resized = resized.movedim(1, -1)
        return (resized,)


class TTResolutionSelector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "use_custom_resolution": ("BOOLEAN", {"default": False}),
                "resolution": (
                    [
                        "512x512 (1:1)",
                        "832x480 (5.2:3) (横屏)",
                        "1024x576 (16:9) (横屏)",
                        "1024x1024 (1:1)",
                        "1280x704 (16:9) (横屏)",
                        "1344x768 (7:4) (横屏)",
                    ],
                    {"default": "832x480 (5.2:3) (横屏)"},
                ),
                "custom_width": ("INT", {"default": 1280, "min": 64, "max": 8192, "step": 8}),
                "custom_height": ("INT", {"default": 704, "min": 64, "max": 8192, "step": 8}),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "run"
    CATEGORY = "workflow_compat/number"

    def run(self, use_custom_resolution=False, resolution="832x480 (5.2:3) (横屏)", custom_width=1280, custom_height=704):
        if use_custom_resolution:
            return (int(custom_width), int(custom_height))

        token = str(resolution).split(" ", 1)[0]
        try:
            width, height = token.lower().split("x", 1)
            return (int(width), int(height))
        except Exception:
            return (int(custom_width), int(custom_height))


class SDVMImageListRepeat:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {f"image{i}": ("IMAGE",) for i in range(1, 11)},
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/image"

    def run(self, **kwargs):
        images = [kwargs.get(f"image{i}") for i in range(1, 11)]
        images = [image for image in images if image is not None]
        if not images:
            raise ValueError("SDVM Image List Repeat needs at least one image input")

        target_h = images[0].shape[1]
        target_w = images[0].shape[2]
        batched = []
        for image in images:
            if image.shape[1] != target_h or image.shape[2] != target_w:
                resized = image.movedim(-1, 1)
                resized = comfy.utils.common_upscale(resized, target_w, target_h, "lanczos", "disabled")
                image = resized.movedim(1, -1)
            batched.append(image)
        return (torch.cat(batched, dim=0),)


class GuHaiAutoImageSplit:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "图像": ("IMAGE",),
                "保存目录": ("STRING", {"default": "output", "multiline": False}),
                "水平张数": ("INT", {"default": 2, "min": 1, "max": 16}),
                "垂直张数": ("INT", {"default": 2, "min": 1, "max": 16}),
                "移除画布边缘": ("BOOLEAN", {"default": True}),
                "移除描边": ("INT", {"default": 0, "min": 0, "max": 128}),
                "文件名前缀": ("STRING", {"default": "compat_split_", "multiline": False}),
                "保存格式": (["PNG", "JPEG", "WEBP"], {"default": "PNG"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("分割图像",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/image"

    def run(self, 图像, 保存目录="output", 水平张数=2, 垂直张数=2, 移除画布边缘=True, 移除描边=0, 文件名前缀="compat_split_", 保存格式="PNG"):
        columns = max(1, int(水平张数))
        rows = max(1, int(垂直张数))
        border = max(0, int(移除描边))
        image = 图像
        height = image.shape[1]
        width = image.shape[2]
        tile_w = width // columns
        tile_h = height // rows
        tiles = []

        for batch_idx in range(image.shape[0]):
            frame = image[batch_idx:batch_idx + 1]
            for row in range(rows):
                for col in range(columns):
                    x0 = col * tile_w
                    y0 = row * tile_h
                    x1 = width if col == columns - 1 else (col + 1) * tile_w
                    y1 = height if row == rows - 1 else (row + 1) * tile_h
                    tile = frame[:, y0:y1, x0:x1, :]
                    if border and tile.shape[1] > border * 2 and tile.shape[2] > border * 2:
                        tile = tile[:, border:-border, border:-border, :]
                    tiles.append(tile)

        target_h = tiles[0].shape[1]
        target_w = tiles[0].shape[2]
        normalized = []
        for tile in tiles:
            if tile.shape[1] != target_h or tile.shape[2] != target_w:
                resized = tile.movedim(-1, 1)
                resized = comfy.utils.common_upscale(resized, target_w, target_h, "lanczos", "disabled")
                tile = resized.movedim(1, -1)
            normalized.append(tile)

        return (torch.cat(normalized, dim=0),)


class Reroute:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("*",)}}

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/flow"

    def run(self, value):
        return (value,)


class SetNode(Reroute):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("*",)}}

    RETURN_NAMES = ("value",)
    CATEGORY = "workflow_compat/flow"


class GetNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"name": ("STRING", {"default": "value", "multiline": False})}}

    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("value",)
    FUNCTION = "run"
    CATEGORY = "workflow_compat/flow"

    def run(self, name="value"):
        raise RuntimeError("GetNode must be converted to direct links by the KJNodes frontend extension before execution.")


NODE_CLASS_MAPPINGS = {
    "Text": Text,
    "CR Text": CRText,
    "Int": Int,
    "StringToInt": StringToInt,
    "Text List": TextList,
    "1hew_TextListToString": TextListToString,
    "ExtractLinesByIndex": ExtractLinesByIndex,
    "ResizeImageResolution": ResizeImageResolution,
    "TTResolutionSelector": TTResolutionSelector,
    "SDVM Image List Repeat": SDVMImageListRepeat,
    "GuHaiAutoImageSplit": GuHaiAutoImageSplit,
    "Reroute": Reroute,
    "SetNode": SetNode,
    "GetNode": GetNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Text": "Text",
    "CR Text": "CR Text",
    "Int": "Int",
    "StringToInt": "String To Int",
    "Text List": "Text List",
    "1hew_TextListToString": "Text List To String",
    "ExtractLinesByIndex": "Extract Lines By Index",
    "ResizeImageResolution": "Resize Image With Resolution",
    "TTResolutionSelector": "TT Resolution Selector",
    "SDVM Image List Repeat": "SDVM Image List Repeat",
    "GuHaiAutoImageSplit": "GuHai Auto Image Split",
    "Reroute": "Reroute",
    "SetNode": "Set Node",
    "GetNode": "Get Node",
}
