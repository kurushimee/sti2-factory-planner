"""Build the smallest loaded reactor with one quad fuel rod and four water hatches."""

import argparse
import json
from pathlib import Path


MACHINE = "modern_industrialization:nuclear_reactor"
FUEL_POSITION = (0, 3, 2)
WATER_POSITIONS = {(-1, 3, 2), (1, 3, 2), (0, 3, 1), (0, 3, 3)}


def fixture(capture, origin):
    reactor = next(machine for machine in capture["machines"] if machine["id"] == MACHINE)
    shape = reactor["shapes"][0]
    cells = shape["cells"]
    if len(cells) != 104:
        raise ValueError("The loaded smallest reactor structure changed.")
    placements = []
    for cell in cells:
        position = tuple(cell["position"])
        block = cell["preview_block"]
        if position == FUEL_POSITION:
            block = "modern_industrialization:nuclear_item_hatch"
        elif position in WATER_POSITIONS:
            block = "modern_industrialization:nuclear_fluid_hatch"
        if position == FUEL_POSITION or position in WATER_POSITIONS:
            expected = "modern_industrialization:nuclear_item" if position == FUEL_POSITION else "modern_industrialization:nuclear_fluid"
            if expected not in cell["allowed_hatches"]:
                raise ValueError("The chosen hatch cannot occupy its captured structure position.")
        placements.append({"position": cell["position"], "block": block})
    if len({tuple(entry["position"]) for entry in placements}) != len(placements):
        raise ValueError("The loaded reactor template repeats a structure position.")
    return {"machine": MACHINE, "origin": list(origin), "placements": sorted(
        placements, key=lambda entry: entry["position"])}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--machines", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = fixture(json.loads(args.machines.read_text(encoding="utf-8")), (832, 160, 0))
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("Prepared the loaded smallest reactor structure with five nuclear hatches.")
