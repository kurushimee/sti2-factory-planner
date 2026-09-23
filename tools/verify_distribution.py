"""Verify the tracked bundle against its manifest and extraction records."""

import gzip
import hashlib
import json
from pathlib import Path

from extraction.bundle_dataset import encode_bundle


def main():
    root = Path(__file__).resolve().parents[1]
    provenance = root / "data/provenance"
    manifest = json.loads((provenance / "distribution-manifest.json").read_text(encoding="utf-8"))
    path = root / "data" / manifest["file"]
    if path.resolve().parent != (root / "data").resolve() or path.suffix != ".gz":
        raise ValueError("The bundle manifest points outside the data directory.")
    packed = path.read_bytes()
    if len(packed) != manifest["bytes"] or hashlib.sha256(packed).hexdigest() != manifest["sha256"]:
        raise ValueError("The compressed dataset does not match its manifest.")
    with gzip.open(path, "rb") as stream:
        encoded = stream.read(128 * 1024 * 1024 + 1)
    if len(encoded) != manifest["json_bytes"] or hashlib.sha256(encoded).hexdigest() != manifest["json_sha256"]:
        raise ValueError("The expanded dataset does not match its manifest.")
    dataset = json.loads(encoded)
    canonical, _ = encode_bundle(dataset)
    if encoded != canonical or dataset["identity"] != manifest["dataset_identity"] or dataset["complete"] != manifest["complete"]:
        raise ValueError("The catalog identity, completeness, or canonical encoding changed.")
    for field in ("resources", "recipes", "unsupported_entries"):
        if len(dataset[field]) != manifest[field]:
            raise ValueError("The catalog count changed: " + field)
    for filename, field in (("distribution-audit.json", "audit_sha256"), ("statech-2.0.1-inputs.json", "extraction_inputs_sha256")):
        if hashlib.sha256((provenance / filename).read_bytes()).hexdigest() != manifest[field]:
            raise ValueError("The bundle's provenance changed: " + filename)
    solar_report = provenance / "solar-panel-report.json"
    if hashlib.sha256(solar_report.read_bytes()).hexdigest() != dataset["source"].get("solar_report_sha256"):
        raise ValueError("The bundled solar rules do not match their loaded-world report.")
    print("The bundled dataset matches its content, audit, and extraction-input hashes.")


if __name__ == "__main__":
    main()
