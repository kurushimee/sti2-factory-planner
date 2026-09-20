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
    if ingredient_rules.get("tested_variant_count", 0) < 11573 or not ingredient_rules.get("variant_item_rules"):
        raise ValueError("The custom ingredient probe did not cover the catalogue's item variants.")
    if any(entry.get("matching_scope") != "captured_resource_variants"
           or entry.get("tested_variants") != ingredient_rules["tested_variant_count"]
           for entry in ingredient_rules["resolved"]):
        raise ValueError("A custom ingredient lacks complete matching evidence for the captured variants.")
    items = {entry["id"]: entry for entry in item_rules["items"]}
    integrations = probes["integration_data_maps"]
    irradiation = integrations["yet_another_industrialization:irradiator_neutron_source"]
    if irradiation["modern_industrialization:beryllium_block"] != {
            "type": "consumption", "probability": 0.05, "probability_check_cooldown": 200, "irradiation": 1280, "eu": 1024}:
        raise ValueError("The loaded beryllium irradiation source changed.")
    if irradiation["yet_another_industrialization:demon_core"] != {
            "type": "lifespan", "probability": 1.0, "probability_check_cooldown": 50, "irradiation": 16384, "eu": 8192}:
        raise ValueError("The loaded demon-core irradiation source changed.")
    solar_cells = {key: value["photovoltaic_cell"] for key, value in items.items() if "photovoltaic_cell" in value}
    if len(solar_cells) != 3 or any(value["lifetime_ticks"] != 12000 or value["minimum_efficiency"] != 0 for value in solar_cells.values()):
        raise ValueError("The loaded photovoltaic cell rules changed.")
    nuclear_fuels = {key: value["nuclear_fuel"] for key, value in items.items() if "nuclear_fuel" in value}
    if len(nuclear_fuels) != 15 or items["yet_another_industrialization:demon_core"]["max_damage"] != 320:
        raise ValueError("The loaded irradiation input rules changed.")
    irradiation_cycles = machines["yet_another_industrialization:nuclear_rod_irradiator"]["irradiation_probe"]
    if len(irradiation_cycles) != len(nuclear_fuels) * len(irradiation) * 2:
        raise ValueError("The irradiation probe did not cover every fuel, source, and hatch count.")
    for sample in irradiation_cycles:
        fuel = nuclear_fuels[sample["fuel"]]
        source = irradiation[sample["source"]]
        ticks = (fuel["disintegrations"] + source["irradiation"] - 1) // source["irradiation"]
        if (sample["completion_tick"], sample["energy_consumed"], sample["output_amount"]) != (
                ticks, (ticks - sample["source_items_consumed_sample"]) * source["eu"], fuel["product_amount"] * sample["hatches"]):
            raise ValueError("The actual irradiation cycle differs from its captured rules.")
        if source["type"] == "lifespan" and sample["source_damage_sample"] != ticks // source["probability_check_cooldown"]:
            raise ValueError("The deterministic demon-core wear changed.")
    lifetime_samples = [sample for sample in irradiation_cycles if "source_lifetime_ticks" in sample]
    if len(lifetime_samples) != 1 or (lifetime_samples[0]["source_lifetime_ticks"], lifetime_samples[0]["energy_through_source_lifetime"]) != (16000, 131063808):
        raise ValueError("The demon-core lifetime or empty-hatch running power changed.")
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
    large_boilers = {}
    for key, machine in machines.items():
        if machine["class"].endswith(".SteamBoilerMultiblockBlockEntity"):
            heater = machine["component_fields"]["aztech.modern_industrialization.machines.components.SteamHeaterComponent"]
            probe = machine["coal_warmup_probe"]
            maximum = heater["SteamHeaterComponent.maxEuProduction"]
            pressure = probe["eu_per_steam_mb"]
            if len(probe["hot_running_probe"]) != maximum // pressure + 1:
                raise ValueError(f"The hot boiler probe is incomplete for {key}.")
            large_boilers[key] = {"rule": {"max_eu_per_tick": maximum, "eu_per_degree": heater["SteamHeaterComponent.euPerDegree"],
                                           "temperature_max": heater["TemperatureComponent.temperatureMax"], "continuous": True,
                                           "eu_per_steam_mb": pressure}, "probe": probe}
    if len(large_boilers) != 4:
        raise ValueError("The loaded large boiler count changed.")
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
    waste_collectors = {key: value["waste_collector_probe"] for key, value in machines.items() if "waste_collector_probe" in value}
    for tier, multiplier in (("bronze", 1), ("steel", 2), ("electric", 4)):
        probe = waste_collectors[f"extended_industrialization:{tier}_waste_collector"]
        energy = "energy:eu" if tier == "electric" else "fluid:modern_industrialization:steam"
        expected = [{"animals": count, "energy_consumed": 600 * multiplier if count else 0,
                     "energy_resource": energy, "deliveries": [{"tick": tick, "amount_mb": multiplier * 500}
                     for tick in (300, 600)] if count else []} for count in range(3)]
        if probe["samples"] != expected or probe["test_ticks"] != 600:
            raise ValueError(f"The loaded {tier} waste collector behavior changed.")
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
    pulse = machines["yet_another_industrialization:pulse_detonation_generator"]["recipe_generation_probe"]
    if len(pulse) != 8:
        raise ValueError("The loaded pulse detonation recipe count changed.")
    recipe_index = {entry["id"]: entry["recipe"] for entry in recipes if entry["origin"] == "recipe_manager"}
    for value in [*generation, *pulse]:
        raw = recipe_index[value["recipe"]]
        amount = next(condition["amount"] for condition in raw["process_conditions"] if condition["type"] == "yet_another_industrialization:energy_generation")
        cycle = value["cycle"]
        if (value["eu_delivered_on_completion"] != amount or cycle["generated_eu"] != amount
                or cycle["completion_tick"] != raw["duration"] or cycle["remaining_items"] != 0 or cycle["remaining_fluid_mb"] != 0
                or cycle["fluid_outputs"] != raw.get("fluid_outputs", [])
                or not value["accepted_with_empty_hatch"] or value["accepted_with_full_hatch"]):
            raise ValueError(f"The actual generator cycle differs from its recipe: {value['recipe']}.")
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
    if [(entry["crafts"], entry.get("ae2_substitutions_verified")) for entry in hammer.get("tool_lifetimes", [])] != [(34, True), (87, True), (209, True), (271, True)]:
        raise ValueError("The loaded hammer lifetime or AE2 reuse behavior changed.")
    if hammer["base_slots"][4]["remainder"].get("components") != {"minecraft:damage": 50}:
        raise ValueError("The loaded hammer crafting action changed.")
    if [len(chapter["item_tasks"]) for chapter in probes["progression_chapters"]] != [29, 173, 127, 229, 214, 19, 115, 95]:
        raise ValueError("The released progression chapter item tasks changed.")
    hatch_capacities = {key: machine["hatch_capacity"] for key, machine in machines.items() if machine.get("hatch_capacity")}
    expected_hatches = {
        "bronze_item_input_hatch": {"item_slots": [64], "fluid_slots_mb": []},
        "highly_advanced_item_output_hatch": {"item_slots": [64] * 15, "fluid_slots_mb": []},
        "bronze_fluid_input_hatch": {"item_slots": [], "fluid_slots_mb": [4000]},
        "highly_advanced_fluid_output_hatch": {"item_slots": [], "fluid_slots_mb": [1024000]},
        "superconductor_energy_output_hatch": {"item_slots": [], "fluid_slots_mb": [], "energy_eu": 76800000000, "cable_eu_per_tick": 128000000},
    }
    for key, expected in expected_hatches.items():
        if hatch_capacities.get("modern_industrialization:" + key) != expected:
            raise ValueError("The loaded hatch capacity changed: " + key)
    boiler_shapes = {}
    for name, count in [("large_steam_boiler", 35), ("advanced_large_steam_boiler", 44),
                        ("high_pressure_large_steam_boiler", 35), ("high_pressure_advanced_large_steam_boiler", 44)]:
        shape = machines["modern_industrialization:" + name]["shapes"]
        if len(shape) != 1 or len(shape[0]["cells"]) != count:
            raise ValueError("The loaded boiler structure changed: " + name)
        boiler_shapes[name] = dict(Counter(cell["preview_block"] for cell in shape[0]["cells"]))
    return {
        "pack": runtime["pack"],
        "runtime_sha256": digest(canonical_runtime(runtime)),
        "recipe_count": len(recipes),
        "recipe_origins": dict(by_origin),
        "recipe_types": dict(sorted(Counter(entry["recipe"]["type"] for entry in recipes).items())),
        "resource_count": len(resource_keys),
        "tag_count": len(runtime["tags"]),
        "machine_count": len(machines),
        "hatch_capacities": hatch_capacities,
        "boiler_shape_blocks": boiler_shapes,
        "multiblock_part_types": sum(machine.get("role") == "multiblock_part" for machine in machines.values()),
        "machines_with_shape_templates": sum(bool(machine.get("shapes")) for machine in machines.values()),
        "arithmetic": probes["arithmetic"],
        "generator_rules": generators,
        "item_rules_count": len(items),
        "resolved_custom_ingredients": len(ingredient_rules["resolved"]),
        "ingredient_tested_variants": ingredient_rules["tested_variant_count"],
        "component_remainder_samples": len(ingredient_rules["variant_item_rules"]),
        "power_units": probes["power_units"],
        "integration_data_maps": integrations,
        "solar_cells": solar_cells,
        "nuclear_fuels": nuclear_fuels,
        "irradiation_cycles": irradiation_cycles,
        "array_rules": arrays,
        "blast_furnace_coils": coil_tiers,
        "boiler_warmup": boilers,
        "large_boilers": large_boilers,
        "fluid_boiler_warmup": {key: machine["diesel_heavy_water_warmup_probe"] for key, machine in machines.items()
                                if "diesel_heavy_water_warmup_probe" in machine},
        "water_pumps": pumps,
        "waste_collectors": waste_collectors,
        "replication": replication,
        "batch_tiers": batch_tiers,
        "recipe_generation": generation,
        "pulse_detonation": pulse,
        "progression_chapters": probes["progression_chapters"],
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
