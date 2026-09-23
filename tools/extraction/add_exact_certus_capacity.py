"""Record the source-derived certus expected rate in an existing player catalog."""

import argparse
from fractions import Fraction
import gzip
import hashlib
import json
from pathlib import Path


def read_catalog(path):
    content = path.read_bytes()
    return json.loads(gzip.decompress(content) if path.suffix == ".gz" else content)


def add_exact_capacity(catalog, report, report_hash):
    if catalog["identity"] != "statech-industry-2:2.0.1" or report["pack"] != "StaTech Industry 2.0.1":
        raise ValueError("The certus report and catalog must describe StaTech Industry 2.0.1.")
    versions = {entry["id"]: entry["version"] for entry in catalog["loaded_mods"]}
    if versions.get("ae2") != report["ae2_version"]:
        raise ValueError("The certus report uses a different AE2 version.")
    growth = report["certus_growth"]
    rate = Fraction(5 * 20, 4 * 6 * growth["growth_chance_denominator"] * growth["accelerator_interval_ticks"])
    farms = {farm["silk_touch"]: farm for farm in report["certus_farms"]}
    if set(farms) != {False, True}:
        raise ValueError("The certus report must contain both farm loadouts.")
    expected = {"certus_growth|crystals", "certus_growth|clusters"}
    found = set()
    for recipe in catalog["recipes"]:
        if recipe["id"] not in expected:
            continue
        if not recipe.get("expected_yields") or recipe["type"] != "planner:certus_growth" or len(recipe["configurations"]) != 1:
            raise ValueError(f"The certus route changed: {recipe['id']}.")
        configuration = recipe["configurations"][0]
        if abs(configuration["operations_per_second"] - float(rate)) > 1e-15:
            raise ValueError(f"The certus capacity changed: {recipe['id']}.")
        configuration["capacity"]["expected_operations_per_second_ratio"] = {
            "numerator": str(rate.numerator), "denominator": str(rate.denominator)}
        silk = recipe["id"] == "certus_growth|clusters"
        idle = Fraction(str(configuration["idle_eu_per_tick"]))
        conversion = idle / Fraction(str(farms[silk]["network_idle_ae_per_tick"]))
        if conversion != Fraction(1, 5):
            raise ValueError("The certus farm uses an unexpected AE-to-EU conversion.")
        energy = Fraction(29 if silk else 21, 1 if silk else 2) * conversion
        if abs(configuration["eu_per_operation"] - float(energy)) > 1e-12:
            raise ValueError("The certus harvest power changed.")
        configuration["eu_per_operation"] = float(energy)
        average = idle + rate * energy / 20
        configuration["capacity"]["average_full_load_eu_per_tick"] = float(average)
        configuration["capacity"]["average_full_load_eu_per_tick_ratio"] = {
            "numerator": str(average.numerator), "denominator": str(average.denominator)}
        found.add(recipe["id"])
    if found != expected:
        raise ValueError(f"Missing certus routes: {sorted(expected - found)}.")
    catalog["source"]["certus_report_sha256"] = report_hash
    return catalog


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    report_bytes = arguments.report.read_bytes()
    catalog = add_exact_capacity(read_catalog(arguments.base), json.loads(report_bytes),
                                 hashlib.sha256(report_bytes).hexdigest())
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(catalog, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
                                encoding="utf-8", newline="\n")
    print(json.dumps({"routes": 2, "expected_rate": "1/12 operations/s", "catalog": str(arguments.output)}))
