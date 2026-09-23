"""Record loaded Spectrum ink conversions and the controlled growth trial."""

import argparse
import hashlib
import json
from pathlib import Path

from spectrum_ink import color_picker_catalog


SPECTRUM_JAR_SHA256 = "6b3f8678c580d381a4e681f7640d637d75808ddce2ae3869d28714b3a347025a"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(runtime_path, jar_path, capture_path, world_path, probe_path):
    if sha256(jar_path) != SPECTRUM_JAR_SHA256:
        raise ValueError("The Spectrum jar differs from the released 2.0.1 pack.")
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    resources, machine, recipes, source_ids = color_picker_catalog(runtime, capture)
    if len(resources) != 16 or len(recipes) != 48 or len(source_ids) != 48:
        raise ValueError("The loaded Color Picker route coverage changed.")
    iron = next((entry["recipe"] for entry in runtime["recipes"]
                 if entry["id"] == "spectrum:crystallarieum/minecraft/iron"), None)
    if not iron or iron.get("ingredient") != {"tag": "c:raw_materials/iron"}:
        raise ValueError("The loaded iron starter changed.")
    if (iron.get("fluid") != {"fluid": "spectrum:liquid_crystal"}
            or iron.get("ink_color") != "spectrum:brown"
            or iron.get("ink_cost_tier") != 2
            or iron.get("seconds_per_growth_stage") != 60
            or [state["Name"] for state in iron.get("growth_stage_states", [])] != [
                "spectrum:small_iron_bud", "spectrum:large_iron_bud", "spectrum:iron_cluster"
            ]):
        raise ValueError("The loaded iron growth rule changed.")
    nugget = next((entry for entry in iron["additives"]
                   if entry["ingredient"] == {"item": "minecraft:iron_nugget"}), None)
    if nugget != {"ingredient": {"item": "minecraft:iron_nugget"},
                  "growth_acceleration_mod": 4, "ink_consumption_mod": 0.5,
                  "consume_chance_per_second": 0.2}:
        raise ValueError("The loaded iron-nugget additive changed.")
    if "CanWork:0b" not in capture.get("without_additive_nbt", ""):
        raise ValueError("The no-additive growth trial did not stop.")
    expected_blocks = {0: "spectrum:small_iron_bud", 299: "spectrum:small_iron_bud",
                       300: "spectrum:large_iron_bud", 599: "spectrum:large_iron_bud",
                       600: "spectrum:iron_cluster"}
    samples = capture.get("samples", [])
    if len(samples) != 10:
        raise ValueError("The controlled growth trial needs two complete cycles.")
    for cycle in range(2):
        previous_additive = 64
        for sample in samples[cycle * 5:(cycle + 1) * 5]:
            tick = sample["tick"]
            if (sample["cycle"] != cycle or sample["block"] != expected_blocks[tick]
                    or sample["fluid_remaining_mb"] != 1000
                    or sample["ink_remaining"] != 10000 - 240 * cycle - 8 * (tick // 20)
                    or sample["additive_remaining"] > previous_additive):
                raise ValueError("The loaded growth trial changed its stage or resource balance.")
            previous_additive = sample["additive_remaining"]
        harvest = capture.get("harvest_" + str(cycle), [])
        if (len(harvest) != 1 or harvest[0]["item"] != "spectrum:pure_iron"
                or not 3 <= harvest[0]["count"] <= 5):
            raise ValueError("The loaded iron-cluster harvest changed.")
    return {
        "pack": "StaTech Industry 2.0.1",
        "minecraft": "1.21.1",
        "spectrum": "1.12.7-1.21.1-neo",
        "spectrum_jar_sha256": SPECTRUM_JAR_SHA256,
        "loaded_runtime_sha256": sha256(runtime_path),
        "trial_capture_sha256": sha256(capture_path),
        "private_world_archive_sha256": sha256(world_path),
        "probe_jar_sha256": sha256(probe_path),
        "color_picker_recipes": len(source_ids),
        "ink_colors": len(resources),
        "color_picker_cycle_ticks": machine["operation_ticks"],
        "brown_dye_ink_per_item": 5,
        "iron_growth_trial": {
            "starter": "c:raw_materials/iron",
            "required_additive": "minecraft:iron_nugget",
            "growth_ticks_to_cluster": 600,
            "brown_ink_per_growth": 240,
            "liquid_crystal_retained_mb": 1000,
            "additive_consumed_in_trials": [64 - samples[4]["additive_remaining"],
                                             samples[4]["additive_remaining"] - samples[9]["additive_remaining"]],
            "pure_iron_harvested_in_trials": [capture["harvest_0"][0]["count"],
                                              capture["harvest_1"][0]["count"]],
            "loaded_loot_range": [3, 5],
        },
        "method": "The released server converted three brown dyes in a placed Color Picker. A separate placed Crystallarieum was ticked through two iron growth cycles, harvested with a normal iron pickaxe, and reseeded.",
        "limits": [
            "The Color Picker output is ink stored in that machine. Ink-network throughput and transfer losses are not yet measured.",
            "The growth trial used explicit harvest and reseed calls. It does not prove a passive automatic production line.",
            "Iron-nugget use and pure-iron harvest are probabilistic. Their measured counts are observations, not fixed operation costs.",
            "The private world, capture, and game jar are not redistributed.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "spectrum_jar", "capture", "world_archive", "probe_jar", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.runtime, args.spectrum_jar, args.capture, args.world_archive, args.probe_jar)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Verified {report['color_picker_recipes']} loaded Color Picker recipes and two iron growth cycles.")
