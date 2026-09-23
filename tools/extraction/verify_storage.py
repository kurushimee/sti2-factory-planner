"""Check the released MI storage units against loaded cable-network samples."""

import argparse
import hashlib
import json
from pathlib import Path


JAR_SHA256 = "95c910c40f6f34dfcf398272303a666e3ccf54dc71650c7d8c5662b10b1b95b1"
TIERS = {"lv": 32, "mv": 128, "hv": 1024, "ev": 8192, "superconductor": 128000000}


def sha256(path):
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def verify_storage(capture):
    if not any(mod["id"] == "modern_industrialization" and mod["version"] == "2.5.8"
               for mod in capture["loaded_mods"]):
        raise ValueError("The released Modern Industrialization version was not loaded.")
    if capture["failures"]:
        raise ValueError("The loaded machine probe reported failures.")
    found = []
    for tier, nominal in TIERS.items():
        machine = f"modern_industrialization:{tier}_storage_unit"
        matches = [row for row in capture["machines"] if row["id"] == machine]
        if len(matches) != 1:
            raise ValueError(f"The loaded {tier} storage unit is missing or duplicated.")
        sample = matches[0].get("storage_probe")
        transfer = nominal * 8
        if not sample or sample.get("capacity_eu") != nominal * 100000 or \
                sample.get("nominal_tier_eu") != nominal or sample.get("cable_limit_eu_per_tick") != transfer or \
                sample.get("charge_eu_over_20_ticks") != transfer * 20 or \
                sample.get("discharge_eu_over_20_ticks") != transfer * 20:
            raise ValueError(f"The loaded {tier} storage capacity or transfer sample changed.")
        found.append({"machine": machine, "capacity_eu": sample["capacity_eu"],
                      "charge_eu_per_tick": transfer, "discharge_eu_per_tick": transfer,
                      "nominal_tier_eu": nominal})
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sha256(args.jar) != JAR_SHA256:
        raise ValueError("The storage probe needs the released Modern Industrialization jar.")
    capture = json.loads(args.capture.read_text(encoding="utf-8"))
    report = {"pack": "StaTech Industry 2.0.1", "mod": "Modern Industrialization 2.5.8",
              "mod_jar_sha256": JAR_SHA256, "capture_sha256": sha256(args.capture),
              "private_world_archive_sha256": sha256(args.world),
              "source_method": "The matching storage-unit registration and EnergyComponent bytecode give capacity, saved energy, and absence of intrinsic decay. Loaded adapters transferred through a one-node ElectricityNetwork for 20 ticks in each direction.",
              "planning_status": "The planner sizes whole units in periodic dispatch and imports saved counts and charge as editable power-plan facts.",
              "limits": ["The transfer samples use injected adjacent adapters, not a placed cable layout.",
                         "A player's shared network, transformer chain, and distribution topology can reduce available transfer.",
                         "Stored charge is a starting quantity, not a sustained power source."],
              "storage_units": verify_storage(capture)}
    with args.output.open("w", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(report, indent=2) + "\n")
    print("Verified five loaded MI storage units and 20-tick charge and discharge samples.")


if __name__ == "__main__":
    main()
