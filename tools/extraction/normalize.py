"""Preserve loaded recipe semantics in a versioned intermediate dataset."""

import argparse
from collections import Counter
import json
import hashlib
from pathlib import Path
from machine_rules import machine_rules


class Unsupported(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def resource_identity(kind, registry_id, components, variants):
    base = kind + ":" + registry_id
    if not components:
        return base
    if variants is None:
        raise Unsupported("Component resources need a variant registry.")
    resource_id = base + "#" + hashlib.sha256(canonical(components).encode()).hexdigest()[:20]
    record = {"id": resource_id, "registry_id": registry_id, "kind": kind,
              "unit": "mB" if kind == "fluid" else "item", "components": components}
    if resource_id in variants and variants[resource_id] != record:
        raise ValueError("A component resource identity collided.")
    variants[resource_id] = record
    return resource_id


def ingredient(value, kind, tags, resolutions=None, variants=None):
    """Resolve alternatives without choosing a material on the player's behalf."""
    if isinstance(value, list):
        return sorted({resource for child in value for resource in ingredient(child, kind, tags, resolutions, variants)})
    if not isinstance(value, dict):
        raise Unsupported("The ingredient is not an object or an alternative list.")
    if value.get("type"):
        key = canonical({key: child for key, child in value.items() if key not in ("amount", "probability")})
        resolved = (resolutions or {}).get(key)
        if not resolved:
            raise Unsupported("This ingredient needs a captured custom predicate adapter.")
        return sorted({resource_identity(kind, stack["id"], stack.get("components"), variants)
                       for stack in resolved.get("matching_stacks", resolved["matching_display_stacks"])})
    if kind in value:
        return [resource_identity(kind, value[kind], value.get("components"), variants)]
    if "tag" in value:
        key = kind + ":" + value["tag"]
        if key not in tags or not tags[key]:
            raise Unsupported("The ingredient tag is empty or unresolved: " + key)
        return [kind + ":" + item for item in sorted(tags[key])]
    raise Unsupported("The ingredient has no supported identity.")


def flow(value, kind, tags, output=False, resolutions=None, variants=None):
    choices = ingredient(value, kind, tags, resolutions, variants)
    if not choices:
        raise Unsupported("The captured ingredient has no matching stacks.")
    amount = value.get("amount", 1) if isinstance(value, dict) else 1
    probability = value.get("probability", 1) if isinstance(value, dict) else 1
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise ValueError("Recipe quantities must be positive.")
    if not isinstance(probability, (int, float)) or not 0 <= probability <= 1:
        raise ValueError("Recipe probabilities must be between zero and one.")
    if output and len(choices) != 1:
        raise Unsupported("An output needs one concrete resource.")
    result = {"choices": choices, "amount": amount, "probability": probability,
              "role": "catalyst" if probability == 0 and not output else "material"}
    if isinstance(value, dict) and value.get("type"):
        result["predicate"] = value
        key = canonical({key: child for key, child in value.items() if key not in ("amount", "probability")})
        result["matching_scope"] = (resolutions or {}).get(key, {}).get("matching_scope", "captured_display_variants")
    return result


def normalize_recipe(entry, tags, resolutions=None, variants=None):
    raw = entry["recipe"]
    recipe_type = raw["type"]
    result = {"id": recipe_type + "|" + entry["id"], "source_id": entry["id"],
              "type": recipe_type, "origin": entry["origin"], "raw": raw,
              "inputs": [], "outputs": [], "conditions": raw.get("process_conditions", [])}
    try:
        if "eu" in raw and "duration" in raw:
            result["mechanic"] = "mi_recipe"
            result["eu_per_tick"] = raw["eu"]
            result["duration_ticks"] = raw["duration"]
            for kind in ("item", "fluid"):
                for direction in ("inputs", "outputs"):
                    result[direction].extend(flow(value, kind, tags, direction == "outputs", resolutions, variants)
                                             for value in raw.get(kind + "_" + direction, []))
        elif recipe_type in ("minecraft:crafting_shaped", "kubejs:shaped",
                             "minecraft:crafting_shapeless", "kubejs:shapeless"):
            result["mechanic"] = "crafting"
            if "pattern" in raw:
                counts = Counter("".join(raw["pattern"]).replace(" ", ""))
                for symbol, amount in counts.items():
                    value = flow(raw["key"][symbol], "item", tags, resolutions=resolutions, variants=variants)
                    value["amount"] = amount
                    result["inputs"].append(value)
            else:
                result["inputs"] = [flow(value, "item", tags, resolutions=resolutions, variants=variants) for value in raw["ingredients"]]
            output = raw["result"]
            result["outputs"] = [flow({"item": output["id"], "amount": output.get("count", 1),
                                       "components": output.get("components")}, "item", tags, True, resolutions, variants)]
            # Runtime remainder and automation rules are separate from ingredient matching.
            result["requirements"] = ["crafting_remainders", "automation_capacity"]
        else:
            raise Unsupported("No process adapter exists for " + recipe_type + ".")
        result["status"] = "normalized"
    except Unsupported as error:
        result["status"] = "unsupported"
        result["reason"] = str(error)
    return result


def normalize(runtime, probes):
    if runtime["failures"] or probes["failures"] or probes.get("item_rules", {}).get("failures") or probes.get("ingredient_rules", {}).get("failures") or probes.get("crafting_rules", {}).get("failures"):
        raise ValueError("Resolve capture failures before normalizing the dataset.")
    variants = {}
    resolutions = {canonical({key: value for key, value in entry["ingredient"].items() if key not in ("amount", "probability")}): entry
                   for entry in probes.get("ingredient_rules", {}).get("resolved", []) if isinstance(entry["ingredient"], dict)}
    recipes = [normalize_recipe(entry, runtime["tags"], resolutions, variants) for entry in runtime["recipes"]]
    ids = [recipe["id"] for recipe in recipes]
    if len(ids) != len(set(ids)):
        raise ValueError("Recipe identities are not unique.")
    resources = [{"id": value["kind"] + ":" + value["id"], "registry_id": value["id"],
                  "kind": value["kind"], "unit": "mB" if value["kind"] == "fluid" else "item"}
                 for value in runtime["resources"]]
    item_rules = {entry["id"]: entry for entry in probes.get("item_rules", {}).get("items", [])}
    for resource in resources:
        if resource["kind"] == "item" and resource["registry_id"] in item_rules:
            resource["item_rules"] = item_rules[resource["registry_id"]]
            resource["name"] = resource["item_rules"]["name"]
    resources.extend(variants.values())
    variant_rules = {}
    for entry in probes.get("ingredient_rules", {}).get("variant_item_rules", []):
        stack = entry["stack"]
        variant_rules[resource_identity("item", stack["id"], stack.get("components"), {})] = entry
    for resource in resources:
        if resource["id"] in variant_rules:
            resource["item_rules"] = variant_rules[resource["id"]]
    known = {value["id"] for value in resources}
    for recipe in recipes:
        for value in recipe["inputs"] + recipe["outputs"]:
            missing = set(value["choices"]) - known
            if missing:
                raise ValueError("Unknown recipe resources: " + str(sorted(missing)))
    coverage = Counter((recipe["type"], recipe["status"]) for recipe in recipes)
    return {"format": "factory-planner-capture", "version": 1,
            "identity": "statech-industry-2:2.0.1", "complete": False,
            "resources": sorted(resources, key=lambda value: value["id"]),
            "recipes": sorted(recipes, key=lambda value: value["id"]),
            "machines": sorted(probes["machines"], key=lambda value: value["id"]),
            "machine_rules": machine_rules(probes["machines"], runtime["data_maps"]["modern_industrialization:machine_upgrades"]),
            "data_maps": {**runtime["data_maps"], **probes.get("integration_data_maps", {})}, "loaded_mods": probes["loaded_mods"],
            "power_units": probes.get("power_units", {}),
            "shape_member_rules": probes.get("shape_member_rules", []),
            "crafting_rules": probes.get("crafting_rules", {}),
            "progression_chapters": probes.get("progression_chapters", []),
            "coverage": [{"type": key[0], "status": key[1], "count": count}
                         for key, count in sorted(coverage.items())]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runtime = json.loads((args.capture / "runtime.json").read_text(encoding="utf-8"))
    probes = json.loads((args.capture / "machines.json").read_text(encoding="utf-8"))
    dataset = normalize(runtime, probes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"recipes": len(dataset["recipes"]),
                      "statuses": dict(Counter(value["status"] for value in dataset["recipes"]))}))
