"""Replace trial-derived Spectrum farm capacities with loaded growth facts."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from spectrum_growth import FARM_MACHINE_ID, farm_machine, growth_variants

OLD_PROBABILITY_LABEL = "Source consumption uses long-term averages; probabilistic consumption is an estimate. Keep consumable source stacks refilled."
NEW_PROBABILITY_LABEL = "Source consumption is the exact long-run expectation from the loaded chance and cooldown; an individual time window can differ. Keep consumable source stacks refilled."


def exact_probability_label(recipe):
    if recipe.get("type") != "planner:irradiation":
        return recipe
    configurations = []
    for configuration in recipe["configurations"]:
        assumptions = configuration["assumptions"]
        if assumptions.count(OLD_PROBABILITY_LABEL) != 1:
            raise ValueError("An irradiation configuration has a different probability label.")
        configurations.append({**configuration, "assumptions": [
            NEW_PROBABILITY_LABEL if entry == OLD_PROBABILITY_LABEL else entry
            for entry in assumptions]})
    return {**recipe, "configurations": configurations}


def refresh(base, runtime, growth_report, lua_sha256, growth_sha256):
    if base["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("The catalog is not the pinned StaTech Industry 2.0.1 release.")
    previous = [recipe for recipe in base["recipes"]
                if recipe.get("type") == "spectrum:crystallarieum_growing"]
    if len(previous) != 60 or not any(machine["id"] == FARM_MACHINE_ID for machine in base["machines"]):
        raise ValueError("The catalog does not contain the 60 previously added growth variants.")
    replacement = growth_variants(runtime, growth_report,
                                  {resource["id"] for resource in base["resources"]})
    if {recipe["id"] for recipe in previous} != {recipe["id"] for recipe in replacement}:
        raise ValueError("The loaded growth variants differ from the existing catalog.")
    replacements = {recipe["id"]: recipe for recipe in replacement}
    irradiation_count = sum(recipe.get("type") == "planner:irradiation" for recipe in base["recipes"])
    if irradiation_count != 30:
        raise ValueError("The pinned catalog has a different irradiation route count.")
    return {
        **base,
        "recipes": [replacements.get(recipe["id"], exact_probability_label(recipe))
                    for recipe in base["recipes"]],
        "machines": [farm_machine() if machine["id"] == FARM_MACHINE_ID else machine
                     for machine in base["machines"]],
        "default_machines": [machine for machine in base["default_machines"]
                             if machine != FARM_MACHINE_ID],
        "progression": [{**preset, "available_machines": [machine for machine in preset["available_machines"]
                           if machine != FARM_MACHINE_ID]} for preset in base["progression"]],
        "source": {**base["source"], "spectrum_growth_report_sha256": growth_sha256,
                   "spectrum_turtle_lua_report_sha256": lua_sha256},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "runtime", "growth_report", "lua_report", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    base_bytes = args.base.read_bytes()
    base = json.loads(gzip.decompress(base_bytes) if args.base.suffix == ".gz" else base_bytes)
    runtime = json.loads(args.runtime.read_text(encoding="utf-8"))
    growth = json.loads(args.growth_report.read_text(encoding="utf-8"))
    result = refresh(base, runtime, growth,
                     hashlib.sha256(args.lua_report.read_bytes()).hexdigest(),
                     hashlib.sha256(args.growth_report.read_bytes()).hexdigest())
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Retained 60 loaded growth variants without trial-derived farm capacities.")
