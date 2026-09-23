"""Add loaded Color Picker ink routes to the pinned planning catalog."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from spectrum_ink import color_picker_catalog


def add_ink_routes(base, runtime, measurement, measurement_sha256):
    if base["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("The base catalog is not the pinned StaTech Industry 2.0.1 release.")
    if any(machine["id"] == "spectrum:color_picker" for machine in base["machines"]):
        raise ValueError("The base catalog already has a Color Picker.")
    resources, machine, recipes, source_ids = color_picker_catalog(runtime, measurement)
    existing = {resource["id"] for resource in base["resources"]}
    if any(resource["id"] in existing for resource in resources):
        raise ValueError("The base catalog already has a generated ink resource.")
    if any(entry["source_id"] in source_ids for entry in base["recipes"]):
        raise ValueError("The base catalog already has a loaded Color Picker route.")
    unsupported = [entry for entry in base["unsupported_entries"] if entry["source_id"] in source_ids]
    if len(unsupported) != len(source_ids) or any(entry["type"] != "spectrum:ink_converting" for entry in unsupported):
        raise ValueError("The base catalog has different unsupported Color Picker entries.")
    referenced = existing | {resource["id"] for resource in resources}
    if any(flow["resource"] not in referenced for recipe in recipes
           for flow in [*recipe["inputs"], *recipe["outputs"],
                        *recipe["configurations"][0]["build_requirements"]]):
        raise ValueError("A loaded Color Picker input is absent from the pinned catalog.")
    progression = []
    for preset in base["progression"]:
        if preset["id"] == "statech:all":
            preset = {**preset, "available_machines": sorted([*preset["available_machines"], machine["id"]])}
        progression.append(preset)
    return {
        **base,
        "resources": [*base["resources"], *resources],
        "machines": [*base["machines"], machine],
        "recipes": [*base["recipes"], *recipes],
        "unsupported_entries": [entry for entry in base["unsupported_entries"] if entry["source_id"] not in source_ids],
        "default_machines": [*base["default_machines"], machine["id"]],
        "progression": progression,
        "source": {**base["source"], "spectrum_ink_capture_sha256": measurement_sha256},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("base", "runtime", "capture", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    base = json.loads(gzip.decompress(args.base.read_bytes()) if args.base.suffix == ".gz"
                      else args.base.read_text(encoding="utf-8"))
    runtime = json.loads(args.runtime.read_text(encoding="utf-8"))
    capture = json.loads(args.capture.read_text(encoding="utf-8"))
    dataset = add_ink_routes(base, runtime, capture, hashlib.sha256(args.capture.read_bytes()).hexdigest())
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
                           encoding="utf-8")
    print("Added 48 loaded Color Picker recipes for 16 ink colors.")
