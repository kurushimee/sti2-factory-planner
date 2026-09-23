"""Archive a stopped, isolated test world without changing its files."""

import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--world", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--zip64-directory", action="store_true", help="Add empty archive-only entries to exercise a ZIP64 directory.")
args = parser.parse_args()
world = args.world.resolve()
output = args.output.resolve()
if not (world / "level.dat").is_file():
    raise SystemExit("The world directory has no level.dat file.")
if output.is_relative_to(world):
    raise SystemExit("Write the archive outside the world directory.")
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(world.rglob("*")):
        if path.is_file() and path.name != "session.lock":
            archive.write(path, "example/" + path.relative_to(world).as_posix())
    if args.zip64_directory:
        for index in range(max(0, 65536 - len(archive.infolist()))):
            archive.writestr(f"zip64-fixture/{index:05d}", b"")
print(output)
