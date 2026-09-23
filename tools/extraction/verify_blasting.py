"""Record the loaded blast-furnace trials without bundling the private world."""

import argparse
import hashlib
import json
from pathlib import Path

from blasting import blasting_catalog


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(normalized, fixture, capture, world_archive, probe_jar):
    selected = json.loads(fixture.read_text(encoding="utf-8"))
    measured = json.loads(capture.read_text(encoding="utf-8"))
    if {entry["recipe"] for entry in selected} != {entry["recipe"] for entry in measured["trials"]}:
        raise ValueError("The measured blast-furnace trials do not match the prepared fixture.")
    source = json.loads(normalized.read_text(encoding="utf-8"))
    machine, recipes, supported = blasting_catalog(source, measured, {})
    if len(recipes) != 32 or len(supported) != 16:
        raise ValueError("The distinct blasting coverage changed.")
    return {
        "pack": "StaTech Industry 2.0.1",
        "minecraft": "1.21.1",
        "neoforge": "21.1.250",
        "spectrum": "1.12.7-1.21.1-neo",
        "spectrum_jar_sha256": "6b3f8678c580d381a4e681f7640d637d75808ddce2ae3869d28714b3a347025a",
        "loaded_runtime_sha256": "521777580a030c3fa2b49b007062243512e4e4299d7854e4969d123b19316d8b",
        "normalized_capture_sha256": sha256(normalized),
        "fixture_sha256": sha256(fixture),
        "trial_capture_sha256": sha256(capture),
        "private_world_archive_sha256": sha256(world_archive),
        "probe_jar_sha256": sha256(probe_jar),
        "source_method": "The released NeoForge server ticked a placed vanilla blast furnace for each distinct loaded Spectrum recipe, with coal fuel. One iron recipe also used a lava bucket. The fixture checked output, timing, and the returned bucket.",
        "source_recipes": sorted(supported),
        "completed_trials": len(measured["trials"]),
        "cooking_ticks": 100,
        "operations_per_second_per_machine": 0.2,
        "fuel_burn_ticks": machine["fuel_burn_ticks"],
        "fuel_per_operation_at_full_load": {fuel: 100 / ticks for fuel, ticks in machine["fuel_burn_ticks"].items()},
        "lava_bucket_remainder": "minecraft:bucket",
        "limits": [
            "Only coal and lava buckets were measured as fuel. Other legal furnace fuels remain unsupported.",
            "Fuel use is amortized over complete burn cycles. A partly loaded furnace must run in buffered bursts to achieve the listed material rate.",
            "The first output needs one ingredient and one whole fuel item per furnace. The private world and capture are not redistributed.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("normalized", "fixture", "capture", "world_archive", "probe_jar", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.normalized, args.fixture, args.capture, args.world_archive, args.probe_jar)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"Verified {report['completed_trials']} loaded blast-furnace trials for {len(report['source_recipes'])} distinct recipes.")
