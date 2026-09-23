"""Add verified storage-unit rules to the pinned normalized pack capture."""

import argparse
import hashlib
import json
from pathlib import Path

from machine_rules import machine_rules


def merge_storage_rules(base, capture, report):
    if base["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("The base capture is not StaTech Industry 2.0.1.")
    expected = {entry["machine"]: entry for entry in report["storage_units"]}
    probed = [entry for entry in capture["machines"] if entry.get("storage_probe")]
    if set(entry["id"] for entry in probed) != set(expected) or len(probed) != len(expected):
        raise ValueError("The storage capture does not contain exactly the reported units.")
    replacements = {entry["id"]: entry for entry in machine_rules(probed, {})}
    for identity, rule in replacements.items():
        recorded = expected[identity]
        if any(rule["storage"][field] != recorded[field] for field in
               ("capacity_eu", "charge_eu_per_tick", "discharge_eu_per_tick")):
            raise ValueError("The storage rule disagrees with the loaded-world report.")
    old = {entry["id"]: entry for entry in base["machine_rules"]}
    for identity, rule in replacements.items():
        if identity not in old or old[identity]["source_class"] != rule["source_class"]:
            raise ValueError("The base capture has a missing or different storage machine.")
    result = {**base, "machine_rules": [replacements.get(entry["id"], entry)
                                        for entry in base["machine_rules"]],
              "storage_capture_sha256": report["capture_sha256"]}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if hashlib.sha256(args.capture.read_bytes()).hexdigest() != json.loads(args.report.read_text())["capture_sha256"]:
        raise ValueError("The storage capture hash does not match the provenance report.")
    merged = merge_storage_rules(json.loads(args.base.read_text(encoding="utf-8")),
                                 json.loads(args.capture.read_text(encoding="utf-8")),
                                 json.loads(args.report.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(merged, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Merged {len(json.loads(args.report.read_text())['storage_units'])} verified storage rules.")
