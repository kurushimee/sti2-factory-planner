"""Check the loaded turtle farm trial and retain its remaining automation limits."""

import argparse
import hashlib
import json
from pathlib import Path


CC_TWEAKED_JAR_SHA256 = "81a903710d109d129c249c105695a96f4bad5e0acf7068920fb191ba791c14ce"
SPECTRUM_JAR_SHA256 = "6b3f8678c580d381a4e681f7640d637d75808ddce2ae3869d28714b3a347025a"


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_measurement(capture):
    for name in ("machine_item_handler", "picker_item_handler", "turtle_item_handler"):
        if capture.get(name) is not True:
            raise ValueError("The placed farm is missing its side item handler: " + name)
    if capture.get("turtle_stationary_fuel") != 0 or capture.get("turtle_fuel_needed") is not True:
        raise ValueError("The stationary turtle's fuel condition changed.")
    cycles = capture.get("cycles", [])
    if len(cycles) != 2:
        raise ValueError("The turtle farm needs two harvested and replanted cycles.")
    total = 0
    previous_additive = None
    for index, cycle in enumerate(cycles):
        if (cycle.get("cycle") != index or cycle.get("mature_tick") != 600
                or not 3 <= cycle.get("collected", 0) <= 5
                or cycle.get("top_cleared") is not True
                or cycle.get("input_chest_remaining") != 1 - index
                or cycle.get("turtle_fuel_remaining") != 0):
            raise ValueError("The turtle did not plant, mature, and harvest both crops.")
        stages = cycle.get("inspected_stages", [])
        if stages != [
            {"tick": 1, "name": "spectrum:small_iron_bud"},
            {"tick": 300, "name": "spectrum:large_iron_bud"},
            {"tick": 600, "name": "spectrum:iron_cluster"},
        ]:
            raise ValueError("The turtle inspection did not distinguish immature and mature crops.")
        total += cycle["collected"]
        if cycle.get("output_chest_total") != total:
            raise ValueError("The turtle output chest did not receive every harvest.")
        if cycle.get("picker_ink", -1) + cycle.get("machine_ink", -1) != 80 * (index + 1):
            raise ValueError("The Spectrum ink network did not balance across the farm.")
        if cycle.get("additive_refill") != (64 if index == 0 else 64 - previous_additive):
            raise ValueError("The nugget stock was not refilled through the machine side handler.")
        if cycle.get("picker_dye_refill") != 64 * index:
            raise ValueError("The Color Picker dye stock was not refilled through its side handler.")
        previous_additive = cycle.get("additive_remaining")
        if not isinstance(previous_additive, int) or not 0 <= previous_additive < 64:
            raise ValueError("The measured nugget stock is invalid.")
    if capture.get("fluid_remaining_mb") != 1000:
        raise ValueError("The liquid-crystal startup fill did not remain in the machine.")
    return cycles


def verify(runtime_path, capture_path, world_path, probe_path, spectrum_jar, cc_jar):
    if sha256(spectrum_jar) != SPECTRUM_JAR_SHA256 or sha256(cc_jar) != CC_TWEAKED_JAR_SHA256:
        raise ValueError("The loaded jars differ from the released pack versions.")
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    cycles = validate_measurement(capture)
    return {
        "pack": "StaTech Industry 2.0.1",
        "spectrum": "1.12.7-1.21.1-neo",
        "cc_tweaked": "1.120.0",
        "spectrum_jar_sha256": SPECTRUM_JAR_SHA256,
        "cc_tweaked_jar_sha256": CC_TWEAKED_JAR_SHA256,
        "loaded_runtime_sha256": sha256(runtime_path),
        "trial_capture_sha256": sha256(capture_path),
        "private_world_archive_sha256": sha256(world_path),
        "probe_jar_sha256": sha256(probe_path),
        "trial": {
            "cycles": 2,
            "mature_ticks": [cycle["mature_tick"] for cycle in cycles],
            "ordinary_harvest_counts": [cycle["collected"] for cycle in cycles],
            "chest_output_total": cycles[-1]["output_chest_total"],
            "brown_ink_per_growth": 240,
            "liquid_crystal_initial_fill_mb": 1000,
            "liquid_crystal_remaining_mb": capture["fluid_remaining_mb"],
            "stationary_turtle_fuel_used": 0,
        },
        "planning_status": "unsupported_passive_route",
        "limits": [
            "The fixture chooses turtle commands directly. A loaded Lua program and its scheduling overhead were not measured.",
            "The fixture advances Color Picker conversion, Spectrum ink transfer, and growth logic directly in a frozen world.",
            "An external supply for both chests, dye, nuggets, and the initial liquid-crystal fill was not built.",
            "Nugget consumption and harvest counts are random; the observed values are samples rather than guaranteed rates.",
            "Construction quantities and a full automatic farm capacity are not established.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "capture", "world_archive", "probe_jar", "spectrum_jar", "cc_jar", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.runtime, args.capture, args.world_archive, args.probe_jar,
                    args.spectrum_jar, args.cc_jar)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("Verified two loaded turtle farm cycles; passive planning remains unsupported.")
