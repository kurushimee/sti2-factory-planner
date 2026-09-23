"""Check loaded Spectrum growth evidence without claiming an automatic farm."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


SPECTRUM_JAR_SHA256 = "6b3f8678c580d381a4e681f7640d637d75808ddce2ae3869d28714b3a347025a"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_measurement(capture):
    early = capture.get("always_on_removed_small_bud_after_ticks")
    if not isinstance(early, int) or not 1 <= early <= 200:
        raise ValueError("The always-on plane must be shown to clear an immature bud.")
    if not 0 < capture.get("grid_idle_ae_per_tick", 0) < 5:
        raise ValueError("The placed AE2 grid needs a measured idle load.")
    cycles = capture.get("cycles", [])
    if len(cycles) != 2:
        raise ValueError("The staged pickup trial needs two complete cycles.")
    for index, cycle in enumerate(cycles):
        if (cycle.get("cycle") != index or cycle.get("mature_tick") != 600
                or not 600 <= cycle.get("growth_ticks", 0) <= 1000
                or not 3 <= cycle.get("harvested", 0) <= 5
                or not cycle.get("plane_active") or not cycle.get("top_cleared")
                or cycle.get("dyes_remaining") != 0
                or cycle.get("network_energy_ae", 0) <= 0):
            raise ValueError("The staged grid did not grow, collect, and clear a mature cluster.")
    if not (64 > cycles[0]["additive_remaining"] >= cycles[1]["additive_remaining"] >= 0):
        raise ValueError("The dropped iron-nugget stock did not match two growth cycles.")
    for index, expected in enumerate((80, 160)):
        if cycles[index]["picker_ink"] + cycles[index]["machine_ink"] != expected:
            raise ValueError("The ink network lost or created ink outside the measured growth cost.")
    if capture.get("fluid_remaining_mb") != 1000:
        raise ValueError("The liquid-crystal fill was not retained.")
    transfer = capture.get("ink_transfer", [])
    if len(transfer) < 4 or transfer[0]["cycle"] != 0 or transfer[0]["tick"] != 1:
        raise ValueError("The placed ink network needs transfer samples.")
    if transfer[0]["picker_ink"] != 3 or transfer[0]["machine_ink"] != 2:
        raise ValueError("The first brown-dye conversion was not transferred through the nodes.")
    if not all(sample["picker_ink"] > 0 and sample["machine_ink"] > 0 for sample in transfer):
        raise ValueError("The ink network did not keep both machines supplied.")
    if "only after the crop reaches its mature cluster state" not in capture.get("pickup_control", ""):
        raise ValueError("The staged trial must identify its unbuilt gate.")
    return cycles


def loaded_growth(runtime, jar, capture):
    recipes = {entry["id"]: entry["recipe"] for entry in runtime["recipes"]
               if entry.get("recipe", {}).get("type") == "spectrum:crystallarieum_growing"}
    samples = {entry["recipe"]: entry for entry in capture.get("loaded_loot_samples", [])}
    if len(recipes) != 20 or len(samples) != 20 or recipes.keys() != samples.keys():
        raise ValueError("The 20 loaded growth recipes and loot samples do not match.")
    results = []
    with ZipFile(jar) as archive:
        for recipe_id, recipe in sorted(recipes.items()):
            cluster = recipe["growth_stage_states"][-1]["Name"]
            sample = samples[recipe_id]
            if sample["cluster"] != cluster or not 3 <= sample["count"] <= 5:
                raise ValueError("A loaded cluster or harvest sample changed: " + recipe_id)
            path = "data/spectrum/loot_table/blocks/" + cluster.split(":", 1)[1] + ".json"
            loot = json.loads(archive.read(path))
            entry = loot["pools"][0]["entries"][0]
            if entry["type"] != "minecraft:alternatives" or len(entry["children"]) != 2:
                raise ValueError("A cluster needs a separately handled loot rule: " + recipe_id)
            silk, ordinary = entry["children"]
            if (silk.get("name") != cluster or not silk.get("conditions")
                    or ordinary.get("name") != sample["item"]
                    or ordinary.get("functions") != [{"function": "minecraft:set_count",
                        "count": {"min": 3, "max": 5}, "add": False}]):
                raise ValueError("The released loot table differs from the loaded harvest: " + recipe_id)
            results.append({"recipe": recipe_id, "cluster": cluster, "ordinary_harvest": sample["item"],
                            "yield_range": [3, 5]})
    return results


def verify(runtime_path, jar_path, capture_path, world_path, probe_path):
    if sha256(jar_path) != SPECTRUM_JAR_SHA256:
        raise ValueError("The Spectrum jar differs from the released 2.0.1 pack.")
    runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    cycles = validate_measurement(capture)
    routes = loaded_growth(runtime, jar_path, capture)
    return {
        "pack": "StaTech Industry 2.0.1", "minecraft": "1.21.1",
        "spectrum": "1.12.7-1.21.1-neo", "spectrum_jar_sha256": SPECTRUM_JAR_SHA256,
        "loaded_runtime_sha256": sha256(runtime_path),
        "trial_capture_sha256": sha256(capture_path),
        "private_world_archive_sha256": sha256(world_path),
        "probe_jar_sha256": sha256(probe_path),
        "growth_recipes": routes,
        "iron_trial": {
            "always_on_bud_removed_after_ticks": capture["always_on_removed_small_bud_after_ticks"],
            "grid_idle_ae_per_tick": capture["grid_idle_ae_per_tick"],
            "mature_ticks": [cycle["mature_tick"] for cycle in cycles],
            "collected_ticks": [cycle["growth_ticks"] for cycle in cycles],
            "harvested_items": [cycle["harvested"] for cycle in cycles],
            "brown_ink_per_growth": 240,
            "liquid_crystal_initial_fill_mb": 1000,
            "liquid_crystal_remaining_mb": capture["fluid_remaining_mb"],
            "nuggets_consumed": [64 - cycles[0]["additive_remaining"],
                                 cycles[0]["additive_remaining"] - cycles[1]["additive_remaining"]],
        },
        "planning_status": "unsupported_passive_route",
        "limits": [
            "The controlled fixture triggers the placed AE2 grid only when the cluster is mature. A player-buildable automatic detector and gate were not verified.",
            "A continuously active Annihilation Plane breaks immature buds. The filtered storage bus does not prevent that loss.",
            "The Color Picker's five-tick conversion step is called directly while the isolated world is frozen; the placed ink network runs its transfer logic.",
            "Growth and harvest quantities are random. The loot range is 3–5; observed counts are not fixed guarantees.",
            "The private world, raw capture, jar, and probe are not redistributed.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "spectrum_jar", "capture", "world_archive", "probe_jar", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.runtime, args.spectrum_jar, args.capture,
                    args.world_archive, args.probe_jar)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Verified {len(report['growth_recipes'])} loaded growth and harvest rules; passive automation remains unsupported.")
