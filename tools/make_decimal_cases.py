"""Write independent IEEE-754 references for Godot's JSON boundary."""

import argparse
import decimal
import gzip
import json
import random
import struct
from pathlib import Path


def cases(dataset):
    values = ["0.0036900369003690036", "1.9104477611940298", "4.773028197126942e-8", "0.10247438140464883",
              "600.0000000000001", "0.0002777777777777778", "0.0", "-0.0", "1e0", "5e-324",
              "2.2250738585072014e-308", "1.7976931348623157e308", "1e-330", "-1e-330"]
    with decimal.localcontext() as context:
        context.prec = 1200
        for bits in [0, 1, 2, 0x000fffffffffffff, 0x3fefffffffffffff, 0x3ff0000000000000,
                     0x3ff0000000000001, 0x7feffffffffffffe]:
            left = struct.unpack("<d", struct.pack("<Q", bits))[0]
            right = struct.unpack("<d", struct.pack("<Q", bits + 1))[0]
            values.append(str((decimal.Decimal(left) + decimal.Decimal(right)) / 2))
    generator = random.Random(29)
    for _ in range(1000):
        bits = generator.randrange(0x7ff0000000000000)
        value = struct.unpack("<d", struct.pack("<Q", bits))[0]
        values.append(repr(value if generator.randrange(2) else -value))

    def visit(value):
        if isinstance(value, float):
            values.append(repr(value))
        elif isinstance(value, dict):
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(dataset)
    return [{"text": value, "bits": struct.pack("<d", float(value)).hex()} for value in dict.fromkeys(values)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    raw = arguments.dataset.read_bytes()
    dataset = json.loads(gzip.decompress(raw) if raw.startswith(b"\x1f\x8b") else raw)
    references = cases(dataset)
    arguments.output.write_text(json.dumps(references) + "\n", encoding="utf-8")
    print(f"Wrote {len(references)} decimal references, including every distinct bundled fractional value.")


if __name__ == "__main__":
    main()
