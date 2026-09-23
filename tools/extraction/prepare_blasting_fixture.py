"""Choose the loaded blasting recipes that lack a captured MI furnace route."""

import argparse
import json
from pathlib import Path


def distinct_blasting(runtime):
    smelting = {(json.dumps(entry["recipe"]["ingredient"], sort_keys=True),
                 entry["recipe"]["result"]["id"], entry["recipe"]["result"].get("count", 1))
                for entry in runtime["recipes"] if entry["recipe"]["type"] == "minecraft:smelting"}
    entries = [entry for entry in runtime["recipes"] if entry["recipe"]["type"] == "minecraft:blasting" and
               (json.dumps(entry["recipe"]["ingredient"], sort_keys=True),
                entry["recipe"]["result"]["id"], entry["recipe"]["result"].get("count", 1)) not in smelting]
    if len(entries) != 16:
        raise ValueError("The distinct blasting set changed; inspect the loaded pack before updating this fixture.")
    result = []
    for entry in entries:
        recipe = entry["recipe"]
        if set(recipe["ingredient"]) != {"item"} or recipe["result"].get("count", 1) != 1 or recipe["cookingtime"] != 100:
            raise ValueError("A distinct blasting recipe needs a new fixture adapter: " + entry["id"])
        result.append({"recipe": entry["id"], "input": recipe["ingredient"]["item"],
                       "output": recipe["result"]["id"], "count": 1, "cooking_ticks": 100,
                       "fuel": "minecraft:coal"})
    result.sort(key=lambda value: value["recipe"])
    iron = next(value for value in result if value["recipe"] == "spectrum:blasting/pure_resources/iron")
    result.append({**iron, "recipe": iron["recipe"] + "|lava_fuel", "fuel": "minecraft:lava_bucket",
                   "fuel_remainder": "minecraft:bucket"})
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    entries = distinct_blasting(json.loads(args.runtime.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} controlled blast-furnace trials.")
