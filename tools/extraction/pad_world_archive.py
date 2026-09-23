"""Add unrelated stored data to a test world ZIP without changing its world entries."""

import argparse
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--mib", type=int, default=512)
    arguments = parser.parse_args()
    if arguments.mib < 1:
        parser.error("Padding must contain at least one MiB.")
    with ZipFile(arguments.source) as source, ZipFile(arguments.output, "x", compression=ZIP_STORED) as output:
        if "unrelated-padding.bin" in source.namelist():
            parser.error("The source already contains the test padding entry.")
        for entry in source.infolist():
            output.writestr(entry, source.read(entry.filename))
        with output.open("unrelated-padding.bin", "w", force_zip64=True) as padding:
            block = bytes(1024 * 1024)
            for _ in range(arguments.mib):
                padding.write(block)
    print(f"Created {arguments.output.stat().st_size} bytes. The original archive is unchanged.")


if __name__ == "__main__":
    main()
