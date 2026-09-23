"""Package the portable planning facts with deterministic compression and provenance."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path


ROOT_FIELDS = set("format identity name complete description resources recipes machines upgrades shape_member_rules progression default_machines route_preferences unsupported_entries loaded_mods source".split())
RESOURCE_FIELDS = set("id registry_id kind unit name max_stack_size components".split())
RECIPE_FIELDS = set("id source_id type origin name primary inputs outputs configurations group conditions catalysts expected_yields process requires_obtained replication crafting_evidence assumptions tool_usage".split())


def encode_bundle(dataset):
    for label, record, allowed in [("dataset", dataset, ROOT_FIELDS),
            *(("resource " + value["id"], value, RESOURCE_FIELDS) for value in dataset["resources"]),
            *(("recipe " + value["id"], value, RECIPE_FIELDS) for value in dataset["recipes"])]:
        unexpected = record.keys() - allowed
        if unexpected:
            raise ValueError(f"Unreviewed distribution fields in {label}: {sorted(unexpected)}")
    for preference in dataset.get("route_preferences", []):
        if preference.keys() - {"preferred", "alternative", "reason"}:
            raise ValueError("Unreviewed distribution fields in a route preference.")
    # Preserve all calculation and import facts. Compression must not change the catalog.
    encoded = (json.dumps(dataset, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    packed = gzip.compress(encoded, compresslevel=9, mtime=0)
    return encoded, packed


def bundle(source, output, audit_path, inputs_path):
    dataset = json.loads(source.read_text(encoding="utf-8"))
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if audit["dataset_identity"] != dataset["identity"]:
        raise ValueError("The distribution audit belongs to a different dataset.")
    encoded, packed = encode_bundle(dataset)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(packed)
    return {"format": 1, "dataset_identity": dataset["identity"], "complete": dataset["complete"],
            "file": output.name, "compression": "gzip", "bytes": len(packed), "json_bytes": len(encoded),
            "sha256": hashlib.sha256(packed).hexdigest(), "json_sha256": hashlib.sha256(encoded).hexdigest(),
            "source_catalog_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "audit_sha256": hashlib.sha256(audit_path.read_bytes()).hexdigest(),
            "extraction_inputs_sha256": hashlib.sha256(inputs_path.read_bytes()).hexdigest(),
            "resources": len(dataset["resources"]), "recipes": len(dataset["recipes"]),
            "unsupported_entries": len(dataset["unsupported_entries"]),
            "contents": audit["distribution_contents"], "exclusions": audit["excluded_contents"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "output", "audit", "inputs", "manifest"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    manifest = bundle(args.source, args.output, args.audit, args.inputs)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(manifest))
