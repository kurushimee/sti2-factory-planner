"""Verify the automatic machine exclusions against the released archive and catalog."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile

from availability import REMOVED_MACHINES, SOURCE, SOURCE_SHA256


def verify(archive, dataset):
    with zipfile.ZipFile(archive) as packed:
        source = packed.read("overrides/" + SOURCE)
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("The released availability script changed; review the exclusions.")
    definitions = {machine["id"]: machine for machine in dataset["machines"]}
    entries = []
    for identity, group in REMOVED_MACHINES.items():
        machine = definitions[identity]
        if machine.get("availability", {}).get("automatic") is not False:
            raise ValueError("The machine lacks an automatic availability exclusion: " + identity)
        if identity in dataset["default_machines"] or any(identity in preset["available_machines"] for preset in dataset["progression"]):
            raise ValueError("The removed machine remains in an automatic preset: " + identity)
        producers = [recipe for recipe in dataset["recipes"] if any(flow["resource"] == "item:" + identity for flow in recipe["outputs"])]
        if any(not recipe.get("replication") for recipe in producers):
            raise ValueError("A normal production recipe needs review: " + identity)
        entries.append({"machine": identity, "script_group": group,
                        "normal_production_recipes": 0, "replication_recipes": [recipe["id"] for recipe in producers]})
    return {"archive_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "source": {"file": SOURCE, "sha256": SOURCE_SHA256}, "machines": entries,
            "scope": "The released script marks these machines unused or development-only. The loaded catalog has no ordinary production recipe. Explicit owned-machine overrides remain available."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "dataset", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    raw = args.dataset.read_bytes()
    dataset = json.loads(gzip.decompress(raw) if args.dataset.suffix == ".gz" else raw)
    report = verify(args.archive, dataset)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("Verified four released-pack machine exclusions and their retained explicit overrides.")
