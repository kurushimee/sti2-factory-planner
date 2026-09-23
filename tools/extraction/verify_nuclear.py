"""Check the loaded MI reactor trials and record their supported operating scope."""

import argparse
import hashlib
import json
from pathlib import Path
from statistics import mean

from prepare_nuclear_fixture import fixture


MI_JAR_SHA256 = "95c910c40f6f34dfcf398272303a666e3ccf54dc71650c7d8c5662b10b1b95b1"
REACTOR = "modern_industrialization:nuclear_reactor"
SINGLE = "modern_industrialization:uranium_fuel_rod"
QUAD = "modern_industrialization:uranium_fuel_rod_quad"
STEAM = "modern_industrialization:steam"
DEUTERIUM = "modern_industrialization:deuterium"
DEPLETED = "modern_industrialization:uranium_fuel_rod_depleted"
CASINGS = {"modern_industrialization:nuclear_alloy_machine_casing_pipe": 27,
           "modern_industrialization:nuclear_casing": 72,
           "modern_industrialization:nuclear_fluid_hatch": 4,
           "modern_industrialization:nuclear_item_hatch": 1}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check_capture(capture, machines, formed):
    require(any(mod == {"id": "modern_industrialization", "version": "2.5.8"}
                for mod in machines["loaded_mods"]), "The loaded MI version changed.")
    placed = fixture(machines, (832, 160, 0))["placements"]
    counted = {}
    for cell in placed:
        counted[cell["block"]] = counted.get(cell["block"], 0) + 1
    require(counted == CASINGS, "The captured reactor shape or hatch layout changed.")
    rules = {entry["id"]: entry["nuclear_fuel"] for entry in machines["item_rules"]["items"]
             if entry["id"] in (SINGLE, QUAD)}
    require(set(rules) == {SINGLE, QUAD}, "The reactor fuel definitions are missing.")
    require(rules[SINGLE] == {"disintegrations": 10240000, "product": DEPLETED,
                              "product_amount": 1, "size": 1,
                              "direct_eu_per_disintegration": 14,
                              "total_eu_per_disintegration": 62}, "The single rod changed.")
    require(rules[QUAD] == {**rules[SINGLE], "disintegrations": 40960000,
                            "product_amount": 4, "size": 4}, "The quad rod changed.")

    trials = capture.get("trials", [])
    require(len(trials) == 4, "One single-rod and three quad-rod trials are required.")
    single, *quad = trials
    single_fluids = single["fluid_outputs"]
    require(single["fuel"] == SINGLE and single["fuel_exhaustion_tick"] == 0
            and single["max_ticks"] == 20000 and single["grid_width"] == 5
            and single["grid_height"] == 5 and single["peak_temperature"] < 500
            and set(single_fluids).issubset({DEUTERIUM, STEAM})
            and 0 <= single["water_used_mb"] * 16 - single_fluids.get(STEAM, 0)
            - single_fluids.get(DEUTERIUM, 0) * 16 <= 64
            and single["water_used_mb"] < 10000 and single["item_outputs"] == {},
            "The isolated single-rod trial changed its fuel, heat, or fluid balance.")
    measurements = []
    for index, trial in enumerate(quad, 1):
        require(trial["fuel"] == QUAD and trial.get("trial") == index
                and trial["coolant"] == "minecraft:water"
                and trial["grid_width"] == 5 and trial["grid_height"] == 5
                and trial["max_ticks"] == 100000
                and trial["fuel_max_temperature"] == 3175
                and 65000 < trial["fuel_exhaustion_tick"] < 68000
                and trial["peak_temperature"] < 2000
                and 24000000 < trial["water_used_mb"] < 26000000
                and trial["item_outputs"] == {DEPLETED: 4},
                f"Quad-rod trial {index} changed its fuel lifetime, safety, or yield.")
        fluids = trial["fluid_outputs"]
        require(set(fluids) == {STEAM, DEUTERIUM}
                and 390000000 < fluids[STEAM] < 405000000
                and 60000 < fluids[DEUTERIUM] < 68000
                and 0 <= trial["water_used_mb"] * 16 - fluids[STEAM]
                - fluids[DEUTERIUM] * 16 <= 64,
                f"Quad-rod trial {index} changed its coolant or fluid balance.")
        samples = trial["samples"]
        require(samples[0]["tick"] == 1
                and all(a["tick"] < b["tick"] and a["water_used_mb"] <= b["water_used_mb"]
                        for a, b in zip(samples, samples[1:])),
                f"Quad-rod trial {index} lacks an ordered warm-up history.")
        measurements.append({"trial": index, "fuel_lifetime_ticks": trial["fuel_exhaustion_tick"],
                             "peak_temperature": trial["peak_temperature"],
                             "water_used_mb": trial["water_used_mb"],
                             "steam_mb": fluids[STEAM], "deuterium_mb": fluids[DEUTERIUM],
                             "depleted_rods": 4,
                             "first_1000_ticks_steam_mb": samples[1]["fluid_outputs"].get(STEAM, 0)})
    require(formed["machine"] == REACTOR and formed["shape_match"] is True
            and formed["placed_blocks_excluding_controller"] == CASINGS,
            "The placed multiblock did not match the captured structure.")
    cycle = formed["reactor_cycle"]
    require(cycle["ticks"] == 5000 and 1400000 < cycle["water_used_mb"] < 1700000
            and 20000000 < cycle["fluid_outputs"][STEAM] < 30000000
            and 0 < cycle["fluid_outputs"][DEUTERIUM] < 10000
            and cycle["peak_temperature"] < 2000
            and 35000000 < cycle["fuel_disintegrations_left"] < 40000000,
            "The placed reactor's startup trial differs from the loaded component behavior.")
    return {"structure_blocks_excluding_controller": CASINGS,
            "fuel_definitions": rules,
            "single_rod_20000_ticks": {"peak_temperature": single["peak_temperature"],
                                        "water_used_mb": single["water_used_mb"],
                                        "steam_mb": single_fluids.get(STEAM, 0),
                                        "deuterium_mb": single_fluids.get(DEUTERIUM, 0),
                                        "remaining_disintegrations": single["samples"][-1]["fuel_disintegrations_left"]},
            "quad_rod_cycles": measurements,
            "quad_measured_means": {key: mean(sample[key] for sample in measurements)
                                    for key in ("fuel_lifetime_ticks", "water_used_mb", "steam_mb", "deuterium_mb")},
            "formed_5000_tick_trial": cycle}


def verify(capture_path, machines_path, formed_path, jar_path, world_path):
    require(sha256(jar_path) == MI_JAR_SHA256, "The MI jar differs from the released pack.")
    capture = json.loads(capture_path.read_text(encoding="utf-8"))
    machines = json.loads(machines_path.read_text(encoding="utf-8"))
    formed = json.loads(formed_path.read_text(encoding="utf-8"))
    evidence = check_capture(capture, machines, formed)
    return {"pack": "StaTech Industry 2.0.1", "mod": "Modern Industrialization 2.5.8",
            "mod_jar_sha256": sha256(jar_path),
            "machine_capture_sha256": sha256(machines_path),
            "component_capture_sha256": sha256(capture_path),
            "formed_capture_sha256": sha256(formed_path),
            "private_world_archive_sha256": sha256(world_path),
            "method": "The loaded MI nuclear grid was run with a central uranium rod and four adjacent water hatches. Three stochastic quad-rod cycles ran to depletion. A separate placed smallest reactor matched the loaded structure and ran 5,000 controller ticks.",
            "planning_status": "Evidence only. No reactor generation route is enabled by this report.",
            "limits": ["These measurements apply to this five-hatch layout, supplied water, and outputs emptied each tick. External fluid-pipe throughput was not tested.",
                       "The samples are stochastic observations, not a guaranteed minimum steam rate or fixed recipe duration. A single-rod trial can produce some steam without reaching sustained quad-rod output.",
                       "The 5,000-tick placed trial confirms formation and startup, not a complete placed fuel lifetime or automatic fuel replacement.",
                       "Steam must be converted by a separate turbine to produce EU. The reactor itself does not generate direct EU."],
            **evidence}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("capture", "machines", "formed", "jar", "world", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    report = verify(args.capture, args.machines, args.formed, args.jar, args.world)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Verified the loaded MI reactor component cycles and placed startup trial.")


if __name__ == "__main__":
    main()
