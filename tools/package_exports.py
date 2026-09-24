"""Create checked development or MI preview archives from Godot exports."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile


PREVIEW_VERSION = "0.1.0-mi-preview.3"
WINDOWS_REQUIRED = {
    "FactoryPlanner.exe", "FactoryPlanner.pck", "package.json", "runtime-manifest.json",
    "kernel/desktop.js", "runtime/node.exe", "licenses/fflate.txt",
    "licenses/highs-js.txt", "licenses/Inter.txt", "licenses/Node.txt",
    "node_modules/highs/package.json", "node_modules/highs/build/highs.mjs",
    "node_modules/highs/build/highs.wasm", "node_modules/highs/build/highs.js",
    "node_modules/highs/LICENSE", "node_modules/highs/README.md",
    "node_modules/highs/types.d.ts",
}
WEB_REQUIRED = {
    "index.html", "index.js", "index.wasm", "index.pck", "bridge.js",
    "index.png", "index.icon.png", "index.apple-touch-icon.png",
    "index.audio.worklet.js", "index.audio.position.worklet.js",
    "kernel/worker.js", "kernel/world-worker.js", "vendor/highs.mjs", "vendor/highs.wasm",
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def files_under(directory):
    if not directory.is_dir():
        raise ValueError(f"Export directory does not exist: {directory}")
    result = {}
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Export contains a symbolic link: {path}")
        if path.is_file():
            relative = path.relative_to(directory).as_posix()
            if not path.stat().st_size:
                raise ValueError(f"Export contains an empty file: {relative}")
            result[relative] = path
    return result


def validate_export(kind, files):
    required = WINDOWS_REQUIRED if kind == "windows" else WEB_REQUIRED
    missing = sorted(required - files.keys())
    if missing:
        raise ValueError(f"{kind} export is missing: {', '.join(missing)}")
    for name in files:
        if name not in required:
            raise ValueError(f"Unexpected file in {kind} export: {name}. Rebuild in a clean directory.")
    if kind == "windows":
        runtime = json.loads(files["runtime-manifest.json"].read_text(encoding="utf-8"))
        if runtime.get("godot") != "4.7.2" or runtime.get("release_ready") is not False:
            raise ValueError("The Windows runtime manifest does not describe this export.")
        if file_digest(files["runtime/node.exe"]) != runtime.get("node_sha256"):
            raise ValueError("The bundled Node executable differs from its runtime manifest.")
    else:
        html = files["index.html"].read_text(encoding="utf-8")
        if "bridge.js" not in html:
            raise ValueError("The web export does not load the local file and persistence bridge.")


def notices(root):
    entries = {
        "notices/ATTRIBUTION.md": root / "data/ATTRIBUTION.md",
        "notices/Inter-OFL.txt": root / "ui/fonts/OFL.txt",
    }
    for path in sorted((root / "data/licenses").glob("*.txt")):
        entries[f"notices/{path.name}"] = path
    if len(entries) < 3 or not all(path.is_file() for path in entries.values()):
        raise ValueError("The source attribution or license notices are missing.")
    return entries


def validate_itch_contents(entries):
    if len(entries) + 1 > 1000:
        raise ValueError("The itch.io archive exceeds 1,000 files.")
    total = 0
    for name, path in entries.items():
        if len(name) > 240:
            raise ValueError(f"The itch.io archive has a path longer than 240 characters: {name}")
        length = path.stat().st_size
        if length > 200_000_000:
            raise ValueError(f"The itch.io archive has a file larger than 200 MB: {name}")
        total += length
    if total > 500_000_000:
        raise ValueError("The itch.io archive exceeds 500 MB after extraction.")


def write_entry(archive, name, source):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    if isinstance(source, Path):
        info.file_size = source.stat().st_size
        with source.open("rb") as original, archive.open(info, "w") as target:
            shutil.copyfileobj(original, target, 1024 * 1024)
    else:
        archive.writestr(info, source, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def package(kind, directory, destination, root, preview=False):
    files = files_under(directory)
    validate_export(kind, files)
    entries = {**files, **notices(root)}
    if preview:
        introduction = root / "docs/mi-preview.md"
        if not introduction.is_file():
            raise ValueError("The MI preview instructions are missing.")
        entries["PREVIEW.md"] = introduction
    if preview and kind == "web":
        validate_itch_contents(entries)
    metadata = []
    for name, path in sorted(entries.items()):
        metadata.append({"path": name, "sha256": file_digest(path), "bytes": path.stat().st_size})
    manifest = {"format": "sti2-export-package", "version": 1, "platform": kind,
                "release_ready": False,
                "source_dataset_sha256": file_digest(root / "data/statech-2.0.1.json.gz"),
                "files": metadata}
    if preview:
        manifest.update({"app_version": PREVIEW_VERSION, "track": "mi-production-preview",
                         "preview_ready": True})
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=True) as archive:
        for name, path in sorted(entries.items()):
            write_entry(archive, name, path)
        write_entry(archive, "package-manifest.json", json.dumps(manifest, sort_keys=True,
                    separators=(",", ":")).encode("utf-8"))
    verify_archive(destination)
    return file_digest(destination)


def verify_archive(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or "package-manifest.json" not in names:
            raise ValueError(f"Archive has duplicate entries or no manifest: {path}")
        manifest = json.loads(archive.read("package-manifest.json"))
        expected = {entry["path"]: entry for entry in manifest["files"]}
        if set(names) != set(expected) | {"package-manifest.json"}:
            raise ValueError(f"Archive inventory differs from its manifest: {path}")
        for name, entry in expected.items():
            checksum = hashlib.sha256()
            length = 0
            with archive.open(name) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    length += len(chunk)
                    checksum.update(chunk)
            if length != entry["bytes"] or checksum.hexdigest() != entry["sha256"]:
                raise ValueError(f"Archive entry differs from its manifest: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--windows", type=Path, default=Path("builds/windows"))
    parser.add_argument("--web", type=Path, default=Path("builds/web"))
    parser.add_argument("--out", type=Path, default=Path("builds/packages"))
    parser.add_argument("--preview", action="store_true",
                        help="Package the verified MI production preview, while leaving full-release readiness false.")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if args.preview:
        archives = [("windows", args.windows, args.out / f"sti2-factory-planner-{PREVIEW_VERSION}-windows.zip"),
                    ("web", args.web, args.out / f"sti2-factory-planner-{PREVIEW_VERSION}-itch.zip")]
    else:
        archives = [("windows", args.windows, args.out / "sti2-factory-planner-windows-development.zip"),
                    ("web", args.web, args.out / "sti2-factory-planner-itch-development.zip")]
    sums = []
    for kind, directory, archive in archives:
        sha256 = package(kind, directory, archive, root, preview=args.preview)
        sums.append(f"{sha256}  {archive.name}")
        print(f"Checked {kind} {'MI preview' if args.preview else 'development'} archive: {archive}")
    (args.out / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="ascii")


if __name__ == "__main__":
    main()
