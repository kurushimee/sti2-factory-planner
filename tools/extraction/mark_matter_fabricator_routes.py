"""Mark the released pack's UU-to-item Matter Fabricator routes as replication."""

import argparse
import gzip
import json
from pathlib import Path


def update(source):
    if source["identity"] != "statech-industry-2:2.0.1":
        raise ValueError("This update applies only to the released StaTech 2.0.1 catalog.")
    routes = [recipe for recipe in source["recipes"]
              if recipe["type"] == "modern_industrialization:matter_fabricator"
              and any(flow.get("resource") == "item:kubejs:uu_matter"
                      for flow in recipe["inputs"])]
    if len(routes) != 232:
        raise ValueError(f"Expected 232 loaded Matter Fabricator routes, found {len(routes)}.")
    for recipe in routes:
        recipe["replication"] = True
    source["source"]["matter_fabricator_rule"] = (
        "The 232 loaded Matter Fabricator UU-to-item routes require replication mode.")
    return source


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = args.base.read_bytes()
    source = json.loads(gzip.decompress(raw) if args.base.suffix == ".gz" else raw)
    result = update(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n",
                           encoding="utf-8")
    print(f"Marked 232 Matter Fabricator routes in {args.output}.")
