"""Archive a stopped, isolated test world without changing its files."""

import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--world", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
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
print(output)
