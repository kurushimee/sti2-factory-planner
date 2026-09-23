"""Add measured blasting routes to the pinned portable catalog."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from blasting import blasting_catalog
from grouping import production_group


def add_blasting_routes(base, normalized, capture, capture_sha256):
    if base["identity"] != normalized["identity"] or base["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("The base catalog and loaded recipe capture do not match StaTech Industry 2.0.1.")
    if any(machine["id"] == "minecraft:blast_furnace" for machine in base["machines"]):
        raise ValueError("The base catalog already contains a blast furnace.")
    names = {resource["id"]: resource.get("name", resource["id"]) for resource in base["resources"]}
    machine, recipes, supported = blasting_catalog(normalized, capture, names)
    unsupported = [entry for entry in base["unsupported_entries"] if entry["source_id"] in supported]
    if len(unsupported) != len(supported) or any(entry["type"] != "minecraft:blasting" for entry in unsupported):
        raise ValueError("The base catalog has different unsupported blasting entries.")
    if any(entry["source_id"] in supported for entry in base["recipes"]):
        raise ValueError("The base catalog already has a route for a distinct blasting recipe.")
    for recipe in recipes:
        recipe["group"] = production_group(recipe)
    progression = []
    for preset in base["progression"]:
        if preset["id"] == "statech:all":
            preset = {**preset, "available_machines": sorted([*preset["available_machines"], machine["id"]])}
        progression.append(preset)
    return {**base,
            "machines": [*base["machines"], machine],
            "recipes": [*base["recipes"], *recipes],
            "unsupported_entries": [entry for entry in base["unsupported_entries"] if entry["source_id"] not in supported],
            "default_machines": [*base["default_machines"], machine["id"]],
            "progression": progression,
            "source": {**base["source"], "blasting_capture_sha256": capture_sha256}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "normalized", "capture", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    base = json.loads(gzip.decompress(args.base.read_bytes()) if args.base.suffix == ".gz"
                      else args.base.read_text(encoding="utf-8"))
    normalized = json.loads(args.normalized.read_text(encoding="utf-8"))
    capture = json.loads(args.capture.read_text(encoding="utf-8"))
    dataset = add_blasting_routes(base, normalized, capture, hashlib.sha256(args.capture.read_bytes()).hexdigest())
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Added {len(dataset['recipes']) - len(base['recipes'])} blasting routes from 16 loaded recipes.")
