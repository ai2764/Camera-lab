from __future__ import annotations

import copy
from typing import Any, Callable


_object_info_provider: Callable[[], dict[str, Any]] = lambda: {}


def set_object_info_provider(provider: Callable[[], dict[str, Any]]) -> None:
    global _object_info_provider
    _object_info_provider = provider


def build_link_map(workflow: dict) -> dict[int, tuple[int, int]]:
    return {int(link[0]): (int(link[1]), int(link[2])) for link in workflow.get("links", [])}


def resolve_link(link_id: int, nodes_by_id: dict[int, dict], links: dict[int, tuple[int, int]]) -> list:
    origin_id, slot = links[int(link_id)]
    origin = nodes_by_id[origin_id]
    if origin.get("type") == "Reroute":
        input_link = origin.get("inputs", [{}])[0].get("link")
        if input_link is None:
            raise RuntimeError(f"Broken reroute node {origin_id}")
        return resolve_link(int(input_link), nodes_by_id, links)
    return [str(origin_id), slot]


def workflow_to_api(workflow: dict) -> dict:
    workflow = expand_subgraphs_recursive(workflow)
    workflow = inline_set_get_nodes(workflow)
    nodes = workflow.get("nodes", [])
    nodes_by_id = {int(node["id"]): node for node in nodes}
    links = build_link_map(workflow)
    info = _object_info_provider()
    api: dict[str, dict] = {}

    for node in nodes:
        node_type = node.get("type")
        if node_type in {"Reroute", "Note", "MarkdownNote", "PreviewAny", "easy showAnything"}:
            continue
        if node_type == "LTXVImgToVideoInplaceKJ":
            api[str(node["id"])] = {"class_type": node_type, "inputs": kj_dynamic_inputs(node, nodes_by_id, links)}
            continue

        inputs = {}
        raw_widget_values = node.get("widgets_values") or []
        widget_map = raw_widget_values if isinstance(raw_widget_values, dict) else {}
        widget_values = [] if widget_map else list(raw_widget_values)
        widget_idx = 0
        for input_def in node.get("inputs", []):
            name = input_def.get("name")
            if not name:
                continue
            link = input_def.get("link")
            if link is not None:
                if int(link) not in links or links[int(link)][0] not in nodes_by_id:
                    widget_name = (input_def.get("widget") or {}).get("name")
                    if widget_name in widget_map:
                        inputs[name] = widget_map[widget_name]
                    elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                        inputs[name] = widget_values[widget_idx]
                        widget_idx += 1
                    continue
                inputs[name] = resolve_link(int(link), nodes_by_id, links)
                if input_def.get("widget") is not None and widget_idx < len(widget_values):
                    widget_idx += 1
            elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                widget_name = (input_def.get("widget") or {}).get("name")
                inputs[name] = widget_map.get(widget_name, widget_values[widget_idx])
                widget_idx += 1
        widget_idx = fill_widget_inputs_from_object_info(node_type, inputs, widget_values, widget_idx, info, widget_map)
        api[str(node["id"])] = {"class_type": node_type, "inputs": inputs, "_meta": {"title": node.get("title", "")}}
    return api


def workflow_subgraph_ids(workflow: dict) -> set[str]:
    return {str(sg.get("id")) for sg in workflow.get("definitions", {}).get("subgraphs", []) if sg.get("id")}


def workflow_has_subgraph_nodes(workflow: dict) -> bool:
    subgraph_ids = workflow_subgraph_ids(workflow)
    return bool(subgraph_ids) and any(str(node.get("type")) in subgraph_ids for node in workflow.get("nodes", []))


def expand_subgraphs_recursive(workflow: dict, max_passes: int = 8) -> dict:
    expanded = workflow
    for _ in range(max_passes):
        if not workflow_has_subgraph_nodes(expanded):
            return expanded
        expanded = expand_subgraphs(expanded)
    return expanded


def inline_set_get_nodes(workflow: dict) -> dict:
    nodes = workflow.get("nodes", [])
    set_links: dict[str, int | None] = {}
    for node in nodes:
        if node.get("type") != "SetNode":
            continue
        key = str((node.get("widgets_values") or [""])[0])
        inputs = node.get("inputs") or []
        set_links[key] = inputs[0].get("link") if inputs else None

    if not set_links:
        return workflow

    expanded = copy.deepcopy(workflow)
    nodes_by_link: dict[int, list[dict[str, Any]]] = {}
    for node in expanded.get("nodes", []):
        for input_def in node.get("inputs") or []:
            link = input_def.get("link")
            if link is not None:
                nodes_by_link.setdefault(int(link), []).append(input_def)

    links_by_origin: dict[int, list[int]] = {}
    for link in expanded.get("links", []):
        try:
            links_by_origin.setdefault(int(link[1]), []).append(int(link[0]))
        except Exception:
            continue

    for node in expanded.get("nodes", []):
        if node.get("type") != "GetNode":
            continue
        key = str((node.get("widgets_values") or [""])[0])
        replacement = set_links.get(key)
        link_ids = set(links_by_origin.get(int(node["id"]), []))
        for output in node.get("outputs") or []:
            for link in output.get("links") or []:
                link_ids.add(int(link))
        for link in link_ids:
            for input_def in nodes_by_link.get(int(link), []):
                input_def["link"] = replacement
    set_get_ids = {int(node["id"]) for node in expanded.get("nodes", []) if node.get("type") in {"GetNode", "SetNode"}}
    expanded["nodes"] = [node for node in expanded.get("nodes", []) if int(node["id"]) not in set_get_ids]
    expanded["links"] = [
        link
        for link in expanded.get("links", [])
        if int(link[1]) not in set_get_ids
    ]
    return expanded


def expand_subgraphs(workflow: dict) -> dict:
    subgraphs = {sg.get("id"): sg for sg in workflow.get("definitions", {}).get("subgraphs", [])}
    if not subgraphs:
        return workflow

    expanded = copy.deepcopy(workflow)
    nodes = expanded.get("nodes", [])
    links = expanded.get("links", [])
    all_link_ids = [int(link[0]) for link in links]
    for subgraph in subgraphs.values():
        all_link_ids.extend(int(link["id"]) for link in subgraph.get("links", []))
    next_link_id = max(all_link_ids + [0]) + 1
    output_links_by_node: dict[int, list[list[Any]]] = {}
    input_links_by_node: dict[int, list[list[Any]]] = {}
    for link in links:
        output_links_by_node.setdefault(int(link[1]), []).append(link)
        input_links_by_node.setdefault(int(link[3]), []).append(link)

    new_nodes: list[dict[str, Any]] = []
    new_links = [link for link in links if str(nodes_by_id(nodes, int(link[1])).get("type")) not in subgraphs and str(nodes_by_id(nodes, int(link[3])).get("type")) not in subgraphs]

    for node in nodes:
        subgraph = subgraphs.get(str(node.get("type")))
        if not subgraph:
            new_nodes.append(node)
            continue

        input_links = {int(link[4]): link for link in input_links_by_node.get(int(node["id"]), [])}
        output_links = output_links_by_node.get(int(node["id"]), [])
        internal_nodes = copy.deepcopy(subgraph.get("nodes", []))
        internal_links = copy.deepcopy(subgraph.get("links", []))

        for internal_link in internal_links:
            link_id = int(internal_link["id"])
            origin_id = int(internal_link["origin_id"])
            target_id = int(internal_link["target_id"])
            if origin_id == -10:
                external = input_links.get(int(internal_link["origin_slot"]))
                if external:
                    new_links.append([
                        next_link_id,
                        int(external[1]),
                        int(external[2]),
                        target_id,
                        int(internal_link["target_slot"]),
                        internal_link.get("type", external[5]),
                    ])
                    replace_node_input_link(internal_nodes, target_id, link_id, next_link_id)
                    next_link_id += 1
                else:
                    replace_node_input_link(internal_nodes, target_id, link_id, None)
                continue

            if target_id == -20:
                for external in output_links:
                    if int(external[2]) != int(internal_link["target_slot"]):
                        continue
                    new_links.append([
                        next_link_id,
                        origin_id,
                        int(internal_link["origin_slot"]),
                        int(external[3]),
                        int(external[4]),
                        internal_link.get("type", external[5]),
                    ])
                    replace_node_input_link(new_nodes, int(external[3]), int(external[0]), next_link_id)
                    next_link_id += 1
                continue

            new_links.append([
                link_id,
                origin_id,
                int(internal_link["origin_slot"]),
                target_id,
                int(internal_link["target_slot"]),
                internal_link.get("type", ""),
            ])

        new_nodes.extend(internal_nodes)

    expanded["nodes"] = new_nodes
    expanded["links"] = new_links
    return expanded


def nodes_by_id(nodes: list[dict[str, Any]], node_id: int) -> dict[str, Any]:
    for node in nodes:
        if int(node["id"]) == node_id:
            return node
    return {}


def replace_node_input_link(nodes: list[dict[str, Any]], node_id: int, old_link: int, new_link: int | None) -> None:
    for node in nodes:
        if int(node["id"]) != node_id:
            continue
        for input_def in node.get("inputs", []):
            if input_def.get("link") == old_link:
                input_def["link"] = new_link


def fill_widget_inputs_from_object_info(
    node_type: str,
    inputs: dict[str, Any],
    widget_values: list[Any],
    widget_idx: int,
    info: dict[str, Any],
    widget_map: dict[str, Any] | None = None,
) -> int:
    widget_map = widget_map or {}
    node_info = info.get(node_type) or {}
    input_order = node_info.get("input_order") or {}
    input_config = node_info.get("input") or {}
    input_defs = {**(input_config.get("required") or {}), **(input_config.get("optional") or {})}
    ordered_names = list(input_order.get("required") or []) + list(input_order.get("optional") or [])
    for name in ordered_names:
        if name in inputs:
            continue
        if name in widget_map:
            inputs[name] = widget_map[name]
            continue
        if not is_widget_input(input_defs.get(name)):
            continue
        if widget_idx >= len(widget_values):
            continue
        while (
            widget_idx < len(widget_values)
            and isinstance(widget_values[widget_idx], str)
            and widget_values[widget_idx] in {"fixed", "increment", "decrement", "randomize"}
        ):
            widget_idx += 1
        if widget_idx >= len(widget_values):
            break
        inputs[name] = widget_values[widget_idx]
        widget_idx += 1
    return widget_idx


def is_widget_input(input_def: Any) -> bool:
    if not isinstance(input_def, list) or not input_def:
        return True
    first = input_def[0]
    if isinstance(first, list):
        return True
    if first in {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}:
        return True
    if isinstance(first, str) and first.startswith("COMFY_DYNAMICCOMBO"):
        return True
    return False


def kj_dynamic_inputs(node: dict, nodes_by_id: dict[int, dict], links: dict[int, tuple[int, int]]) -> dict:
    inputs: dict[str, Any] = {"num_images": str((node.get("widgets_values") or ["2"])[0])}
    widget_values = list(node.get("widgets_values") or [])[1:]
    widget_idx = 0
    for input_def in node.get("inputs", []):
        name = input_def.get("name")
        if not name:
            continue
        link = input_def.get("link")
        if name in {"vae", "latent"} and link is not None:
            inputs[name] = resolve_link(int(link), nodes_by_id, links)
            continue
        if name.startswith("num_images."):
            if link is not None:
                inputs[name] = resolve_link(int(link), nodes_by_id, links)
            elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                inputs[name] = widget_values[widget_idx]
                widget_idx += 1
    return inputs
