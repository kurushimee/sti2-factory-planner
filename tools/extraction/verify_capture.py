"""Validate a private runtime capture and emit a compact evidence report."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def canonical_runtime(data: dict) -> dict:
    result = dict(data)
    result["recipes"] = sorted(data["recipes"], key=lambda entry: (entry["recipe"]["type"], entry["id"]))
    result["resources"] = sorted(data["resources"], key=lambda entry: (entry["kind"], entry["id"]))
    result["tags"] = {key: sorted(values) for key, values in data["tags"].items()}
    result["failures"] = sorted(data["failures"], key=lambda entry: entry["id"])
    return result


def digest(data: dict) -> str:
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def verify(runtime: dict, probes: dict) -> dict:
    if runtime["failures"] or probes["failures"]:
        raise ValueError("The capture contains extraction failures.")
    recipes = runtime["recipes"]
    keys = [(entry["recipe"]["type"], entry["id"]) for entry in recipes]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate recipe type and ID pairs were captured.")
    resource_keys = {entry["kind"] + ":" + entry["id"] for entry in runtime["resources"]}
    if len(resource_keys) != len(runtime["resources"]):
        raise ValueError("Duplicate resources were captured.")
    for key, values in runtime["tags"].items():
        kind = key.split(":", 1)[0]
        for value in values:
            if kind + ":" + value not in resource_keys:
                raise ValueError(f"Tag {key} contains unknown resource {value}.")
    by_origin = Counter(entry["origin"] for entry in recipes)
    expected_origins = {"recipe_manager": 20399, "machine_recipe_provider": 6082}
    if dict(by_origin) != expected_origins:
        raise ValueError(f"Reference recipe counts changed: {dict(by_origin)}")
    if len(probes["machines"]) != 211:
        raise ValueError("Reference machine count changed.")
    samples = {entry["efficiency"]: entry["max_eu"] for entry in probes["arithmetic"]}
    if samples != {0: 8, 1: 8, 10: 14, 100: 32, 600: 32}:
        raise ValueError(f"The loaded MI arithmetic differs from the reference: {samples}")
    machines = {entry["id"]: entry for entry in probes["machines"]}
    assembler = machines["mi_tweaks:large_scale_assembler"]
    if assembler["batch_limit"] != 16 or assembler["batch_energy_probe_output"] != 13600000:
        raise ValueError("The Large Scale Assembler batch probe changed.")
    if assembler["multi_processing_array_eligible"]:
        raise ValueError("The array eligibility rule changed.")
    if not machines["modern_industrialization:electric_macerator"]["processing_array_eligible"]:
        raise ValueError("The singleblock array rejects the reference macerator.")
    if not machines["modern_industrialization:distillation_tower"]["multi_processing_array_eligible"]:
        raise ValueError("The multiblock array rejects the reference tower.")
    diesel = machines["modern_industrialization:lv_diesel_generator"]["fuel_rules"]
    diesel_fuels = {entry["resource"]: entry["eu_per_unit"] for entry in diesel["fuels"]}
    if diesel["max_eu_per_tick"] != 64 or diesel_fuels.get("fluid:modern_industrialization:diesel") != 800:
        raise ValueError("The loaded diesel generator conversion changed.")
    generators = {machine["id"]: machine["fuel_rules"] for machine in probes["machines"] if "fuel_rules" in machine}
    for generator in generators.values():
        for fuel in generator["fuels"]:
            if fuel["resource"] not in resource_keys or fuel["eu_per_unit"] <= 0:
                raise ValueError("A generator has an invalid fuel mapping.")
    item_rules = probes["item_rules"]
    ingredient_rules = probes["ingredient_rules"]
    if item_rules["failures"] or ingredient_rules["failures"]:
        raise ValueError("The item or ingredient probe contains extraction failures.")
    items = {entry["id"]: entry for entry in item_rules["items"]}
    if len(items) != 11573 or items["minecraft:coal"]["burn_ticks"] != 1600:
        raise ValueError("The loaded item rules changed.")
    if items["minecraft:water_bucket"]["crafting_remainder"]["id"] != "minecraft:bucket":
        raise ValueError("The water bucket remainder changed.")
    if items["extended_industrialization:processing_array"]["replicable"]:
        raise ValueError("The pack's processing-array replication blacklist changed.")
    if probes["power_units"] != {"fe_per_eu": 10, "fe_per_ae": 2.0, "ae_usage_multiplier": 1.0}:
        raise ValueError("The loaded power conversions changed.")
    arrays = {key: {"shape_capacities": machines[key]["array_shape_capacities"], "upgrades": machines[key]["array_allows_upgrades"]}
              for key in ("extended_industrialization:processing_array", "industrialization_overdrive:multi_processing_array")}
    if any(value != {"shape_capacities": [8, 16, 32, 64], "upgrades": True} for value in arrays.values()):
        raise ValueError("The loaded array configuration changed.")
    coil_tiers = machines["modern_industrialization:electric_blast_furnace"]["coil_tiers"]
    if [tier["recipe_eu_limit"] for tier in coil_tiers] != [32, 128, 1024]:
        raise ValueError("The loaded blast furnace coil limits changed.")
    boilers = {key: machines[key]["coal_warmup_probe"] for key in ("modern_industrialization:bronze_boiler", "modern_industrialization:steel_boiler")}
    if [value["first_full_output_tick"] for value in boilers.values()] != [3906, 2417]:
        raise ValueError("The loaded cold-boiler warm-up changed.")
    pumps = {key: value["water_pump_probe"] for key, value in machines.items() if "water_pump_probe" in value}
    for tier, multiplier in (("bronze", 1), ("steel", 2), ("electric", 16)):
        pump = pumps[f"modern_industrialization:{tier}_water_pump"]
        expected_energy = "energy:eu" if tier == "electric" else "fluid:modern_industrialization:steam"
        if (pump["water_multiplier"] != multiplier or pump["operation_ticks"] != 100
                or pump["energy_consumed_in_200_ticks"] != 200 or pump["energy_resource"] != expected_energy
                or pump["deliveries"] != [{"tick": tick, "water_mb": multiplier * 1000} for tick in (100, 200)]
                or [(sample["neighbor_mask"], sample["source_count"]) for sample in pump["neighbor_samples"]]
                != [(0, 0), (1, 0), (3, 2), (255, 8)]):
            raise ValueError(f"The loaded {tier} water pump behavior changed.")
    if items["modern_industrialization:iron_hammer"]["max_damage"] != 1666:
        raise ValueError("The pack's iron hammer durability changed.")
    replication = machines["modern_industrialization:replicator"]["replication_probe"]
    if (replication["deliveries"] != [{"tick": tick, "items": 1} for tick in (20, 40, 60)]
            or replication["template_remaining"] != 1 or replication["uu_matter_consumed"] != 300):
        raise ValueError("The loaded replicator throughput or template consumption changed.")
    batch_tiers = {key: value["batch_tiers"] for key, value in machines.items() if "batch_tiers" in value}
    generation = machines["yet_another_industrialization:dragon_egg_energy_siphon"]["recipe_generation_probe"]
    if (len(generation) != 2 or sorted(value["eu_delivered_on_completion"] for value in generation) != [102400, 204800]
            or any(value["duration_ticks"] != 100 or value["recipe_eu"] != 1 or value["internal_progress_eu"] != 1
                   or not value["accepted_with_empty_hatch"] or value["accepted_with_full_hatch"] for value in generation)):
        raise ValueError("The loaded dragon-egg siphon burst generation changed.")
    for key, limits, discounts in (("extended_industrialization:large_electric_furnace", [16, 32, 64], [0.75] * 3),
                                   ("industrialization_overdrive:pyrolyse_oven", [1, 4, 8], [0.9, 0.8, 0.75])):
        if ([tier["batch_limit"] for tier in batch_tiers[key]] != limits
                or [tier["energy_multiplier"] for tier in batch_tiers[key]] != discounts):
            raise ValueError(f"The loaded structure tiers changed for {key}.")
    crafting = probes["crafting_rules"]
    if crafting["failures"] or len(crafting["recipes"]) != 7301:
        raise ValueError("The crafting probe failed or its coverage changed.")
    crafting_index = {entry["id"]: entry for entry in crafting["recipes"]}
    hammer = crafting_index["modern_industrialization:iron_plate_from_hammer"]
    if hammer["base_slots"][4]["remainder"].get("components") != {"minecraft:damage": 50}:
        raise ValueError("The loaded hammer crafting action changed.")
    return {
        "pack": runtime["pack"],
        "runtime_sha256": digest(canonical_runtime(runtime)),
        "recipe_count": len(recipes),
        "recipe_origins": dict(by_origin),
        "recipe_types": dict(sorted(Counter(entry["recipe"]["type"] for entry in recipes).items())),
        "resource_count": len(resource_keys),
        "tag_count": len(runtime["tags"]),
        "machine_count": len(machines),
        "multiblock_part_types": sum(machine.get("role") == "multiblock_part" for machine in machines.values()),
        "machines_with_shape_templates": sum(bool(machine.get("shapes")) for machine in machines.values()),
        "arithmetic": probes["arithmetic"],
        "generator_rules": generators,
        "item_rules_count": len(items),
        "resolved_custom_ingredients": len(ingredient_rules["resolved"]),
        "power_units": probes["power_units"],
        "array_rules": arrays,
        "blast_furnace_coils": coil_tiers,
        "boiler_warmup": boilers,
        "water_pumps": pumps,
        "replication": replication,
        "batch_tiers": batch_tiers,
        "recipe_generation": generation,
        "crafting_rules_count": len(crafting["recipes"]),
        "crafting_samples_unavailable": sum("unavailable" in entry for entry in crafting["recipes"]),
        "crafting_samples": [crafting_index[key] for key in ("minecraft:cake", "minecraft:torch", "modern_industrialization:iron_plate_from_hammer")],
        "loaded_mods": probes["loaded_mods"],
        "extraction_failures": 0,
        "normalized_dataset_complete": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()
    runtime = json.loads((args.capture / "runtime.json").read_text(encoding="utf-8"))
    probes = json.loads((args.capture / "machines.json").read_text(encoding="utf-8"))
    report = verify(runtime, probes)
    if args.compare:
        previous = json.loads(args.compare.read_text(encoding="utf-8"))
        if canonical_runtime(previous) != canonical_runtime(runtime):
            raise ValueError("Repeated runtime capture changed.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Validated {report['recipe_count']} recipes and {report['machine_count']} machines.")


if __name__ == "__main__":
    main()
