"""Check the loaded autonomous turtle trial and its saved startup program."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

from verify_turtle_growth import CC_TWEAKED_JAR_SHA256, SPECTRUM_JAR_SHA256


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_measurement(capture):
    ticks = capture.get("harvest_ticks", [])
    if (len(ticks) != 2 or not all(isinstance(tick, int) for tick in ticks)
            or not 600 <= ticks[0] <= 1000 or not 600 <= ticks[1] - ticks[0] <= 1000):
        raise ValueError("The unpaused Lua program needs two plausible complete growth cycles.")
    if not 6 <= capture.get("output_chest_count", 0) <= 10 or capture.get("input_chest_remaining") != 0:
        raise ValueError("The autonomous turtle did not move both crops between its chests.")
    if capture.get("computer_on") is not True or capture.get("turtle_fuel_remaining") != 0:
        raise ValueError("The stationary computer must remain on without movement fuel.")
    if capture.get("picker_ink", -1) + capture.get("machine_ink", -1) != 160:
        raise ValueError("The hopper-fed Color Picker and ink network did not balance.")
    if capture.get("picker_dyes") != 0 or not 0 <= capture.get("machine_nuggets", -1) <= 64:
        raise ValueError("The placed machine stocks do not match the fed growth cycles.")
    if capture.get("liquid_crystal_remaining_mb") != 1000:
        raise ValueError("The initial liquid-crystal fill was not retained.")
    return ticks


def verify(runtime_path, capture_path, world_path, probe_path, spectrum_jar, cc_jar, startup_path):
    if sha256(spectrum_jar) != SPECTRUM_JAR_SHA256 or sha256(cc_jar) != CC_TWEAKED_JAR_SHA256:
        raise ValueError("The loaded jars differ from the released pack versions.")
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    ticks = validate_measurement(capture)
    with ZipFile(world_path) as archive:
        programs = [name for name in archive.namelist() if name.endswith("/startup.lua")
                    and "/computercraft/computer/" in name]
        if len(programs) != 1 or archive.read(programs[0]) != startup_path.read_bytes():
            raise ValueError("The saved turtle program differs from the tested startup program.")
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
        "startup_program_sha256": sha256(startup_path),
        "iron_trial": {
            "harvest_ticks": ticks,
            "repeat_interval_ticks": ticks[1] - ticks[0],
            "output_chest_items": capture["output_chest_count"],
            "brown_ink_per_growth": 240,
            "liquid_crystal_initial_fill_mb": 1000,
            "liquid_crystal_remaining_mb": capture["liquid_crystal_remaining_mb"],
            "stationary_turtle_fuel_used": 0,
        },
        "planning_status": "autonomous_iron_trial_verified",
        "limits": [
            "One loaded two-cycle iron run establishes autonomous operation, not a guaranteed harvest yield or upper throughput bound.",
            "Input chests held finite starter, dye, and nugget stocks; their upstream production and full construction bill remain to be planned.",
            "The 1,000 mB liquid-crystal fill was supplied at startup; its acquisition and loss replacement remain separate requirements.",
            "The program names iron stages and output. Other loaded Crystallarieum recipes still need matching automation and costs.",
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("runtime", "capture", "world_archive", "probe_jar", "spectrum_jar",
                 "cc_jar", "startup", "output"):
        parser.add_argument("--" + name.replace("_", "-"), type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.runtime, args.capture, args.world_archive, args.probe_jar,
                    args.spectrum_jar, args.cc_jar, args.startup)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("Verified two autonomous iron harvests from the loaded Lua turtle.")
