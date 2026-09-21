"""Inventory license declarations and planning-data contributors in the pinned pack."""

import argparse
from collections import Counter
import hashlib
from io import BytesIO
import json
from pathlib import Path
import tomllib
import zipfile


def archive_records(content, location, depth=0):
    if depth > 4:
        raise ValueError("Nested mod archives exceed the audit depth limit.")
    records = []
    with zipfile.ZipFile(BytesIO(content)) as archive:
        names = archive.namelist()
        declarations = []
        for name in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml"):
            if name in names:
                metadata = tomllib.loads(archive.read(name).decode("utf-8"))
                declarations.extend({"id": mod["modId"], "declared_version": str(mod.get("version", "")),
                    "license": metadata.get("license", "Not declared"), "name": mod.get("displayName", mod["modId"]),
                    "homepage": mod.get("displayURL", ""), "authors": mod.get("authors", "")}
                    for mod in metadata.get("mods", []))
        if "fabric.mod.json" in names and not declarations:
            metadata = json.loads(archive.read("fabric.mod.json"))
            declarations.append({"id": metadata["id"], "declared_version": metadata.get("version", ""),
                "license": metadata.get("license", "Not declared"), "name": metadata.get("name", metadata["id"]),
                "homepage": metadata.get("contact", {}).get("homepage", ""), "authors": metadata.get("authors", [])})
        licenses = [{"path": name, "sha256": hashlib.sha256(archive.read(name)).hexdigest()}
                    for name in names if not name.endswith("/") and len(name.split("/")) <= 3
                    and Path(name).name.lower().startswith(("license", "licence", "copying", "notice"))]
        if declarations:
            records.append({"archive": location, "sha256": hashlib.sha256(content).hexdigest(),
                            "mods": declarations, "license_files": licenses,
                            "recipe_namespaces": sorted({name.split("/")[1] for name in names
                                if name.startswith("data/") and len(name.split("/")) > 3
                                and name.split("/")[2] in ("recipe", "recipes")})})
        for name in names:
            if name.lower().endswith(".jar"):
                records.extend(archive_records(archive.read(name), location + "!/" + name, depth + 1))
    return records


def audit(instance, dataset):
    archives = []
    for path in sorted((instance / "mods").glob("*.jar")):
        if path.name == "planner-probe.jar":
            continue
        archives.extend(archive_records(path.read_bytes(), path.name))
    indexed = {}
    for archive in archives:
        for mod in archive["mods"]:
            indexed.setdefault(mod["id"], []).append({"archive": archive["archive"], **mod})
    contributors = Counter(recipe["source_id"].split(":", 1)[0] for recipe in dataset["recipes"])
    return {"format": 1, "dataset_identity": dataset["identity"],
            "scope": "Declared mod metadata and archive license-file hashes. Declarations are recorded as supplied, not inferred permissions.",
            "distribution_contents": ["Resource identities and display names", "Recipe quantities and measured machine rules",
                                      "Progression references", "Extraction provenance and unsupported-entry reports"],
            "excluded_contents": ["Minecraft and mod executables", "Textures and sounds", "Quest prose", "World saves", "Original recipe scripts"],
            "loaded_mods": [{**mod, "declarations": indexed.get(mod["id"], [])} for mod in dataset["loaded_mods"]],
            "recipe_contributors": [{"namespace": namespace, "recipes": count, "declarations": indexed.get(namespace, []),
                                     "recipe_archives": [archive["archive"] for archive in archives if namespace in archive["recipe_namespaces"]]}
                                    for namespace, count in sorted(contributors.items())],
            "archives": archives}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instance", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.instance, json.loads(args.dataset.read_text(encoding="utf-8")))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"archives": len(result["archives"]), "contributors": len(result["recipe_contributors"]),
                      "without_declaration": [entry["namespace"] for entry in result["recipe_contributors"] if not entry["declarations"]]}))
