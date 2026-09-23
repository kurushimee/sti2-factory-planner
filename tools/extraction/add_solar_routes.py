"""Add source-derived clear-sky solar routes and exact cell-wear cycles."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from solar_cell_cycle import cell_cycle
from verify_solar import ACTIVE_TICKS, MATCHING_JAR_SHA256, TIERS, clear_day_power, clear_efficiency


def segments(values):
    runs = []
    for value in values:
        if runs and runs[-1]["eu_per_tick"] == value:
            runs[-1]["ticks"] += 1
        else:
            runs.append({"ticks": 1, "eu_per_tick": value})
    return runs


def add_solar_routes(base, report, report_sha256):
    if base.get("identity") != "statech-industry-2:2.0.1" or report.get("pack") != "StaTech Industry 2.0.1":
        raise ValueError("The solar report and catalog must describe the pinned StaTech release.")
    if report.get("mod_jar_sha256") != MATCHING_JAR_SHA256 or len(report.get("panels", [])) != 3:
        raise ValueError("The solar report does not match the released Extended Industrialization jar.")
    resources = {entry["id"] for entry in base["resources"]}
    machines = {entry["id"]: entry for entry in base["machines"]}
    if any(recipe["id"].startswith("planner:solar|") for recipe in base["recipes"]):
        raise ValueError("The base catalog already has solar routes.")
    active_positions = [tick for tick in range(24000) if clear_efficiency(tick) > 0]
    if len(active_positions) != ACTIVE_TICKS:
        raise ValueError("The released solar daylight rule changed.")
    converted = []
    recipes = []
    for tier, peak in TIERS.items():
        machine_id = f"extended_industrialization:{tier}_solar_panel"
        cell = f"extended_industrialization:{tier}_photovoltaic_cell"
        row = next((entry for entry in report["panels"] if entry["machine"] == machine_id), None)
        if not row or row.get("cell") != cell or row.get("peak_eu_per_tick") != peak or row.get("cell_lifetime_active_ticks") != 12000:
            raise ValueError(f"The measured {tier.upper()} solar panel changed.")
        if machines.get(machine_id, {}).get("status") != "unsupported":
            raise ValueError(f"The base catalog has a different {tier.upper()} solar machine.")
        if any(item not in resources for item in ["energy:eu", "item:" + machine_id, "item:" + cell,
                                                   "fluid:extended_industrialization:distilled_water"]):
            raise ValueError(f"The {tier.upper()} solar inputs are missing from the catalog.")
        converted.append(machine_id)
        for water in (False, True):
            mode = "water" if water else "dry"
            values = clear_day_power(peak, water)
            measured = row[f"{mode}_clear_day"]
            if (sum(values) != measured["nominal_eu_per_day"] or
                    measured["distilled_water_mb_per_clear_day"] != (ACTIVE_TICKS if water else 0)):
                raise ValueError(f"The {tier.upper()} {mode} curve disagrees with the measured report.")
            cycle = cell_cycle(values, active_positions, row["cell_lifetime_active_ticks"],
                               2 if water else 1)
            loss = cycle["energy_eu_without_expiry_per_day"] - cycle["minimum_energy_eu_in_one_clear_day"]
            identity = f"planner:solar|{machine_id}|{mode}"
            assumptions = [
                "Clear weather, open sky, a supplied photovoltaic cell, and a free energy output are required.",
                f"The loaded wear rule consumes exactly {cycle['cells_used_per_repeating_cycle']} cells over {cycle['repeating_clear_days']} clear days with continuous replacement.",
                "The credited output is the exact minimum for one clear day with a cell expiry at peak output. The source-derived long-run average is higher.",
                "A replacement removes one active output tick. The periodic dispatch reserves for any event phase.",
                "The player must supply the initial cell and the reported initial storage charge before continuous operation.",
            ]
            if water:
                assumptions.append("Distilled water is consumed at each of the 11,999 active daylight ticks.")
                assumptions.append("The wet cell-wear cycle assumes uninterrupted loaded operation; a chunk reload resets the unsaved tick phase.")
            recipes.append({
                "id": identity, "source_id": f"{machine_id}#{mode}", "origin": "loaded_solar_component_and_world_probe",
                "type": "planner:solar_generation", "name": f"{tier.upper()} solar panel ({mode})",
                "group": "Power", "primary": "energy:eu",
                "inputs": [{"resource": "item:" + cell,
                            "amount": cycle["cells_used_per_repeating_cycle"] / (cycle["repeating_clear_days"] * 1200)},
                           *([{"resource": "fluid:extended_industrialization:distilled_water",
                               "amount": ACTIVE_TICKS / 1200}] if water else [])],
                "outputs": [{"resource": "energy:eu", "amount": cycle["minimum_energy_eu_in_one_clear_day"] / 1200}],
                "configurations": [{"id": identity, "machine": machine_id, "operations_per_second": 1,
                                    "build_requirements": [{"resource": "item:" + machine_id, "amount": 1}],
                                    "startup_profile": {"kind": "periodic_cell", "cell_resource": "item:" + cell},
                                    "periodic_generation": {"period_ticks": 24000, "segments": segments(values),
                                                            "one_event_loss_eu_per_period": loss,
                                                            "cell_cycle": cycle,
                                                            "assumptions": assumptions}}],
            })
    machine_records = [{**entry, **({"status": "supported", "mechanic": "periodic_generation",
                                   "recipe_type": "planner:solar_generation",
                                   "solar_report_sha256": report_sha256} if entry["id"] in converted else {})}
                       for entry in base["machines"]]
    progression = []
    storage_ids = [entry["id"] for entry in base["machines"] if entry.get("mechanic") == "energy_storage"
                   and entry.get("status") == "infrastructure"]
    for preset in base["progression"]:
        if preset["id"] == "statech:all":
            preset = {**preset, "available_machines": sorted(set([*preset["available_machines"], *converted, *storage_ids]))}
        progression.append(preset)
    return {**base, "machines": machine_records, "recipes": [*base["recipes"], *recipes],
            "progression": progression,
            "source": {**base["source"], "solar_report_sha256": report_sha256}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("base", "report", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    args = parser.parse_args()
    raw = args.base.read_bytes()
    base = json.loads(gzip.decompress(raw) if args.base.suffix == ".gz" else raw)
    report = json.loads(args.report.read_text(encoding="utf-8"))
    output = add_solar_routes(base, report, hashlib.sha256(args.report.read_bytes()).hexdigest())
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Added six clear-sky solar routes with exact cell-wear rates and daily minimum output.")
