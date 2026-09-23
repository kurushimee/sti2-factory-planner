"""Regenerate the six solar routes in an existing StaTech catalog."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from add_solar_routes import add_solar_routes
from verify_solar import TIERS


SOLAR_MACHINES = {f"extended_industrialization:{tier}_solar_panel" for tier in TIERS}
SOLAR_RECIPES = {f"planner:solar|{machine}|{mode}"
                 for machine in SOLAR_MACHINES for mode in ("dry", "water")}


def refresh_solar_routes(dataset, report, report_sha256):
    old = {recipe["id"] for recipe in dataset["recipes"]
           if recipe["id"].startswith("planner:solar|")}
    if old != SOLAR_RECIPES or dataset.get("source", {}).get("solar_report_sha256") != report_sha256:
        raise ValueError("The existing solar routes do not match the pinned source report.")
    machine_records = []
    for machine in dataset["machines"]:
        if machine["id"] in SOLAR_MACHINES:
            if machine.get("status") != "supported" or machine.get("mechanic") != "periodic_generation":
                raise ValueError("The solar machine behavior changed before this refresh.")
            machine = {**machine, "status": "unsupported"}
        machine_records.append(machine)
    base = {**dataset, "recipes": [recipe for recipe in dataset["recipes"]
                                   if recipe["id"] not in SOLAR_RECIPES],
            "machines": machine_records}
    updated = add_solar_routes(base, report, report_sha256)
    if len(updated["recipes"]) != len(dataset["recipes"]):
        raise ValueError("Regenerating solar routes changed the recipe count.")
    replacements = {recipe["id"]: recipe for recipe in updated["recipes"]
                    if recipe["id"] in SOLAR_RECIPES}
    updated["recipes"] = [replacements[recipe["id"]] if recipe["id"] in replacements else recipe
                          for recipe in dataset["recipes"]]
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("base", "report", "output"):
        parser.add_argument("--" + field, type=Path, required=True)
    args = parser.parse_args()
    source = args.base.read_bytes()
    dataset = json.loads(gzip.decompress(source) if args.base.suffix == ".gz" else source)
    report = json.loads(args.report.read_text(encoding="utf-8"))
    sha256 = hashlib.sha256(args.report.read_bytes()).hexdigest()
    updated = refresh_solar_routes(dataset, report, sha256)
    args.output.write_text(json.dumps(updated, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
    print("Regenerated six solar routes from the pinned cell-wear and daylight rules.")


if __name__ == "__main__":
    main()
