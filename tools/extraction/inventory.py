"""Record the exact released inputs without copying game files into Git."""

import argparse
import hashlib
import json
from pathlib import Path
import tomllib
import zipfile


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory(server: Path, client: Path) -> dict:
    manifest = json.loads((client / "manifest.json").read_text(encoding="utf-8"))
    mods = []
    for path in sorted((server / "mods").glob("*.jar")):
        record = {"file": path.name, "sha256": sha256(path)}
        with zipfile.ZipFile(path) as archive:
            for name in ("META-INF/neoforge.mods.toml", "META-INF/mods.toml"):
                if name in archive.namelist():
                    metadata = tomllib.loads(archive.read(name).decode("utf-8"))
                    record["license"] = metadata.get("license", "Not declared")
                    record["mods"] = [
                        {key: mod[key] for key in ("modId", "version", "displayName") if key in mod}
                        for mod in metadata.get("mods", [])
                    ]
                    break
        mods.append(record)
    inputs = []
    for folder in ("kubejs", "config", "defaultconfigs"):
        for path in sorted((server / folder).rglob("*")):
            if path.is_file():
                inputs.append({"path": path.relative_to(server).as_posix(), "sha256": sha256(path)})
    return {
        "pack": "StaTech Industry 2.0.1",
        "minecraft": manifest["minecraft"],
        "manifest_sha256": sha256(client / "manifest.json"),
        "curseforge_files": manifest["files"],
        "mods": mods,
        "inputs": inputs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", type=Path, required=True)
    parser.add_argument("--client", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = inventory(args.server, args.client)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Recorded {len(result['mods'])} mod archives and {len(result['inputs'])} pack inputs.")


if __name__ == "__main__":
    main()
