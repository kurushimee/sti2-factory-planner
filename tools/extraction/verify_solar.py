"""Check loaded solar samples and record the clear-day source calculation."""

import argparse
import hashlib
import json
from pathlib import Path
import struct


TIERS = {"lv": 32, "mv": 128, "hv": 512}
ACTIVE_TICKS = 11999
MATCHING_JAR_SHA256 = "22c68835266a83a77511d3f341cbdecb7c9eee0f1c9e7318d7c77283691e5c9c"


def sha256(path):
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def f32(value):
    return struct.unpack("f", struct.pack("f", value))[0]


def clear_efficiency(tick):
    if tick > 12000:
        return 0.0
    if 1500 <= tick <= 10500:
        return 1.0
    return max(0.0, f32(f32(f32(-tick * tick) / f32(15750000.0)) +
                         f32(f32(2.0 * f32(tick)) / f32(2625.0))))


def clear_day(peak, water=False):
    output = []
    for tick in range(24000):
        efficiency = clear_efficiency(tick)
        power = f32(peak * efficiency)
        output.append(int(float(power) * (1.5 if water else 1.0)) if efficiency > 0 else 0)
    total = sum(output)
    average = total / 24000
    stock = 0.0
    minimum = maximum = 0.0
    for power in output:
        stock += power - average
        minimum = min(minimum, stock)
        maximum = max(maximum, stock)
    return {"nominal_eu_per_day": total, "daily_average_eu_per_tick": average,
            "ideal_storage_eu_for_flat_average": maximum - minimum,
            "distilled_water_mb_per_clear_day": ACTIVE_TICKS if water else 0}


def verify_samples(samples, machine_capture):
    items = {entry["id"]: entry for entry in machine_capture["item_rules"]["items"]}
    if len(samples) != len(TIERS):
        raise ValueError("All three loaded solar tiers are required.")
    checked = []
    for tier, peak in TIERS.items():
        machine = f"extended_industrialization:{tier}_solar_panel"
        cell = f"extended_industrialization:{tier}_photovoltaic_cell"
        row = next((entry for entry in samples if entry["machine"] == machine), None)
        rule = items.get(cell, {}).get("photovoltaic_cell")
        if not row or row.get("cell") != cell or rule != {"tier": tier, "eu_per_tick": peak,
                "lifetime_ticks": 12000, "minimum_efficiency": 0.0}:
            raise ValueError(f"The loaded {tier.upper()} solar cell changed or was not captured.")
        expected = [(0, 0, 0), (1500, peak, 1), (6000, peak, 2), (10500, peak, 3),
                    (12000, 0, 3), (12001, 0, 3)]
        observed = [(entry["time"], entry["generated_eu"], entry["cell_ticks"])
                    for entry in row["clear_samples"]]
        if observed != expected or row.get("can_see_sky") is not True:
            raise ValueError(f"The clear-sky {tier.upper()} solar sample changed.")
        if (row.get("distilled_water_generated_eu") != peak * 3 // 2 or
                row.get("distilled_water_remaining_mb") != 9 or
                row.get("distilled_water_cell_ticks") != 4 or
                row.get("rain_generated_eu") != 0 or
                row.get("blocked_stone_present") is not True or
                row.get("blocked_can_see_sky") is not False or
                row.get("blocked_generated_eu") != 0):
            raise ValueError(f"The water, rain, or settled roof sample changed for {tier.upper()} solar.")
        checked.append({"machine": machine, "cell": cell, "cell_lifetime_active_ticks": 12000,
                        "peak_eu_per_tick": peak, "clear_samples": row["clear_samples"],
                        "water_boost_eu_per_tick_at_noon": row["distilled_water_generated_eu"],
                        "rain_eu_per_tick_at_noon": 0, "settled_roof_eu_per_tick_at_noon": 0,
                        "dry_clear_day": clear_day(peak), "water_clear_day": clear_day(peak, True)})
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--machines", type=Path, required=True)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--world", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    samples = json.loads(args.capture.read_text(encoding="utf-8"))
    machines = json.loads(args.machines.read_text(encoding="utf-8"))
    jar_sha256 = sha256(args.jar)
    if jar_sha256 != MATCHING_JAR_SHA256 or not any(mod["id"] == "extended_industrialization" and
            mod["version"] == "1.16.2-1.21.1" for mod in machines["loaded_mods"]):
        raise ValueError("The solar probe needs the released Extended Industrialization jar and loaded mod version.")
    report = {"pack": "StaTech Industry 2.0.1", "mod": "Extended Industrialization 1.16.2-1.21.1",
              "mod_jar_sha256": jar_sha256, "capture_sha256": sha256(args.capture),
              "private_world_archive_sha256": sha256(args.world),
              "source_method": "The matching SolarSunlightComponent and SolarGeneratorComponent bytecode gives the curve, item wear, and water rule. Loaded panels confirmed the listed output and condition samples.",
              "planning_status": "The period-average output cannot supply a continuous factory without verified energy storage. Solar generation remains unsupported by the planner.",
              "profile_limits": ["The daily totals assume clear weather, open sky, supplied cells, and an empty output buffer.",
                                 "They omit the one-tick output gap when a cell expires and a replacement enters.",
                                 "The storage figure assumes an ideal lossless store and a flat load at exactly the daily average; it is not a build bill."],
              "panels": verify_samples(samples, machines)}
    with args.output.open("w", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(report, indent=2) + "\n")
    print("Verified three loaded solar panels, water use, rain and roof shutoff, and code-derived clear-day profiles.")


if __name__ == "__main__":
    main()
