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
    return {
        "pack": runtime["pack"],
        "runtime_sha256": digest(canonical_runtime(runtime)),
        "recipe_count": len(recipes),
        "recipe_origins": dict(by_origin),
        "recipe_types": dict(sorted(Counter(entry["recipe"]["type"] for entry in recipes).items())),
        "resource_count": len(resource_keys),
        "tag_count": len(runtime["tags"]),
        "machine_count": len(machines),
        "arithmetic": probes["arithmetic"],
        "generator_rules": generators,
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
