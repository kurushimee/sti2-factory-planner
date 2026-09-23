"""Add loaded Spectrum growth and the measured ink-node delivery bill."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from spectrum_growth import FARM_MACHINE_ID, growth_variants


def add_growth_routes(base, runtime, growth_report, lua_report, growth_sha256, lua_sha256):
    if base["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("The base catalog is not the pinned StaTech Industry 2.0.1 release.")
    if lua_report.get("planning_status") != "autonomous_iron_trial_verified":
        raise ValueError("The autonomous iron trial has not been verified.")
    if any(machine["id"] == FARM_MACHINE_ID for machine in base["machines"]):
        raise ValueError("The base catalog already has a turtle growth farm.")
    resource_ids = {resource["id"] for resource in base["resources"]}
    recipes = growth_variants(runtime, growth_report, resource_ids)
    source_ids = {entry["recipe"] for entry in growth_report["growth_recipes"]}
    unsupported = [entry for entry in base["unsupported_entries"] if entry["source_id"] in source_ids]
    if len(unsupported) != len(source_ids) or any(entry["type"] != "spectrum:crystallarieum_growing"
                                                   for entry in unsupported):
        raise ValueError("The base catalog has different unsupported growth entries.")
    if any(recipe["id"] in {entry["id"] for entry in base["recipes"]} for recipe in recipes):
        raise ValueError("The base catalog already has a loaded growth route.")
    extra_bill = [
        {"resource": "item:spectrum:ink_node", "amount": 1},
        {"resource": "item:minecraft:hopper", "amount": 1},
        {"resource": "item:minecraft:chest", "amount": 1},
    ]
    if any(flow["resource"] not in resource_ids for flow in extra_bill):
        raise ValueError("An ink delivery part is absent from the pinned catalog.")
    updated_recipes = []
    ink_routes = 0
    for recipe in base["recipes"]:
        if recipe.get("type") != "spectrum:ink_converting":
            updated_recipes.append(recipe)
            continue
        ink_routes += 1
        configurations = []
        for configuration in recipe["configurations"]:
            if configuration["machine"] != "spectrum:color_picker":
                raise ValueError("A loaded ink route has an unexpected machine.")
            configurations.append({
                **configuration,
                "build_requirements": [*configuration["build_requirements"], *extra_bill],
                "assumptions": [
                    "One input converts every five game ticks while the Color Picker has room for its ink.",
                    "A placed ink-node pair transferred brown ink to a Crystallarieum in the loaded pack. This bill includes the Color Picker's node, feeder hopper, and stock chest.",
                ],
            })
        updated_recipes.append({**recipe, "configurations": configurations})
    if ink_routes != 48:
        raise ValueError("The pinned catalog has a different Color Picker route count.")
    machine = {
        "id": FARM_MACHINE_ID,
        "status": "supported",
        "mechanic": "fixed_cycle",
        "recipe_type": "spectrum:crystallarieum_growing",
        "assumptions": [
            "One Crystallarieum, a stationary diamond-pickaxe turtle, and a nearby ink node form each farm allocation.",
            "Capacity includes a visible turtle timing allowance beyond the loaded growth rule.",
        ],
    }
    machines = []
    for entry in base["machines"]:
        if entry["id"] == "spectrum:color_picker":
            entry = {**entry, "assumptions": [
                "The fixed-cycle rate comes from the matching Spectrum server tick logic.",
                "A placed two-node network transferred stored ink to a Crystallarieum. The configuration includes its source node and feeder.",
            ]}
        machines.append(entry)
    progression = []
    for preset in base["progression"]:
        if preset["id"] == "statech:all":
            preset = {**preset, "available_machines": sorted([*preset["available_machines"], FARM_MACHINE_ID])}
        progression.append(preset)
    return {
        **base,
        "machines": [*machines, machine],
        "recipes": [*updated_recipes, *recipes],
        "unsupported_entries": [entry for entry in base["unsupported_entries"]
                                if entry["source_id"] not in source_ids],
        "default_machines": [*base["default_machines"], FARM_MACHINE_ID],
        "progression": progression,
        "source": {**base["source"], "spectrum_growth_report_sha256": growth_sha256,
                   "spectrum_turtle_lua_report_sha256": lua_sha256},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "runtime", "growth_report", "lua_report", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    base = json.loads(gzip.decompress(args.base.read_bytes()) if args.base.suffix == ".gz"
                      else args.base.read_text(encoding="utf-8"))
    runtime = json.loads(args.runtime.read_text(encoding="utf-8"))
    growth = json.loads(args.growth_report.read_text(encoding="utf-8"))
    lua = json.loads(args.lua_report.read_text(encoding="utf-8"))
    dataset = add_growth_routes(base, runtime, growth, lua,
                                hashlib.sha256(args.growth_report.read_bytes()).hexdigest(),
                                hashlib.sha256(args.lua_report.read_bytes()).hexdigest())
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
    print("Added the loaded Spectrum growth variants and ink delivery bill.")
