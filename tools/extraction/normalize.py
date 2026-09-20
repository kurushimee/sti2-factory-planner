"""Preserve loaded recipe semantics in a versioned intermediate dataset."""

import argparse
from collections import Counter
import json
from pathlib import Path


class Unsupported(ValueError):
    pass


def ingredient(value, kind, tags):
    """Resolve alternatives without choosing a material on the player's behalf."""
    if isinstance(value, list):
        return sorted({resource for child in value for resource in ingredient(child, kind, tags)})
    if not isinstance(value, dict):
        raise Unsupported("The ingredient is not an object or an alternative list.")
    if value.get("components") or value.get("type"):
        raise Unsupported("This ingredient needs a component or custom predicate adapter.")
    if kind in value:
        return [kind + ":" + value[kind]]
    if "tag" in value:
        key = kind + ":" + value["tag"]
        if key not in tags or not tags[key]:
            raise Unsupported("The ingredient tag is empty or unresolved: " + key)
        return [kind + ":" + item for item in sorted(tags[key])]
    raise Unsupported("The ingredient has no supported identity.")


def flow(value, kind, tags, output=False):
    choices = ingredient(value, kind, tags)
    amount = value.get("amount", 1) if isinstance(value, dict) else 1
    probability = value.get("probability", 1) if isinstance(value, dict) else 1
    if not isinstance(amount, (int, float)) or amount <= 0:
        raise ValueError("Recipe quantities must be positive.")
    if not isinstance(probability, (int, float)) or not 0 <= probability <= 1:
        raise ValueError("Recipe probabilities must be between zero and one.")
    if output and len(choices) != 1:
        raise Unsupported("An output needs one concrete resource.")
    return {"choices": choices, "amount": amount, "probability": probability,
            "role": "catalyst" if probability == 0 and not output else "material"}


def normalize_recipe(entry, tags):
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
                    result[direction].extend(flow(value, kind, tags, direction == "outputs")
                                             for value in raw.get(kind + "_" + direction, []))
        elif recipe_type in ("minecraft:crafting_shaped", "kubejs:shaped",
                             "minecraft:crafting_shapeless", "kubejs:shapeless"):
            result["mechanic"] = "crafting"
            if "pattern" in raw:
                counts = Counter("".join(raw["pattern"]).replace(" ", ""))
                for symbol, amount in counts.items():
                    result["inputs"].append({"choices": ingredient(raw["key"][symbol], "item", tags),
                                             "amount": amount, "probability": 1, "role": "material"})
            else:
                result["inputs"] = [flow(value, "item", tags) for value in raw["ingredients"]]
            output = raw["result"]
            if output.get("components"):
                raise Unsupported("The crafting result has components that need an identity adapter.")
            result["outputs"] = [flow({"item": output["id"], "amount": output.get("count", 1)}, "item", tags, True)]
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
    if runtime["failures"] or probes["failures"]:
        raise ValueError("Resolve capture failures before normalizing the dataset.")
    recipes = [normalize_recipe(entry, runtime["tags"]) for entry in runtime["recipes"]]
    ids = [recipe["id"] for recipe in recipes]
    if len(ids) != len(set(ids)):
        raise ValueError("Recipe identities are not unique.")
    resources = [{"id": value["kind"] + ":" + value["id"], "registry_id": value["id"],
                  "kind": value["kind"], "unit": "mB" if value["kind"] == "fluid" else "item"}
                 for value in runtime["resources"]]
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
            "data_maps": runtime["data_maps"], "loaded_mods": probes["loaded_mods"],
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
