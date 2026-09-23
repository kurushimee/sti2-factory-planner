"""Check exhaustive runtime projection evidence and compare previously captured states."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path


def verify(probes, previous):
    if probes["failures"]:
        raise ValueError("The runtime probe contains failures.")
    rules = probes["shape_member_rules"]
    if len(rules) != len(previous):
        raise ValueError("The shape rule identities changed.")
    reports = []
    for index, (rule, old) in enumerate(zip(rules, previous)):
        if rule["source_class"] != old["source_class"] or rule["state_only_verified"] != old["state_only_verified"]:
            raise ValueError("The shape rule source changed.")
        if not rule["state_only_verified"]:
            continue
        if not rule.get("projection_verified") or not (rule["projection_checked_state_count"] >= rule["matching_state_count"] >= len(rule["matching_states"])):
            raise ValueError("A state projection lacks exhaustive loaded-state verification.")
        by_block = {}
        for state in rule["matching_states"]:
            by_block.setdefault(state["Name"], []).append(state["Properties"])
        for state in old["matching_states"]:
            if not any(all(state["Properties"].get(key) == value for key, value in properties.items())
                       for properties in by_block.get(state["Name"], [])):
                raise ValueError(f"The projection lost a previously accepted state: {state}")
        encoded = json.dumps(rule["matching_states"], sort_keys=True, separators=(",", ":")).encode()
        reports.append({"rule": index, "source_class": rule["source_class"], "old_patterns": len(old["matching_states"]),
                        "patterns": len(rule["matching_states"]), "matching_loaded_states": rule["matching_state_count"],
                        "checked_loaded_states": rule["projection_checked_state_count"], "sha256": hashlib.sha256(encoded).hexdigest()})
    return {"scope": "The Java probe checks membership for every loaded state of each matching block before and after projection. This comparison also checks every previously captured accepted pattern.",
            "rules": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--previous", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = args.previous.read_bytes()
    previous = json.loads(gzip.decompress(raw) if args.previous.suffix == ".gz" else raw)
    probes = json.loads((args.capture / "machines.json").read_text(encoding="utf-8"))
    report = verify(probes, previous["shape_member_rules"])
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Verified {len(report['rules'])} loaded state predicates.")


if __name__ == "__main__":
    main()
