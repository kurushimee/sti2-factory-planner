"""Check the loaded certus growth, filtered harvest, and energy branches."""

import argparse
import json
from pathlib import Path


def verify_certus(capture):
    expected = {"accelerator_interval_ticks": 10, "growth_chance_denominator": 5,
                "decay_chance_denominator": 12, "accelerator_local_ae_per_call": 80,
                "accelerator_network_idle_ae_per_tick": 8}
    for field, value in expected.items():
        if capture.get(field) != value:
            raise ValueError(f"Certus rule changed: {field}")
    parents = ["flawless_budding_quartz", "flawed_budding_quartz", "chipped_budding_quartz", "damaged_budding_quartz"]
    decayed = [parents[0], parents[2], parents[3], "quartz_block"]
    stages = ["small_quartz_bud", "medium_quartz_bud", "large_quartz_bud", "quartz_cluster"]
    transitions = [{"parent": "ae2:" + parent, "stage": stage, "grown": "ae2:" + grown,
                    "decayed_parent": "ae2:" + after}
                   for parent, after in zip(parents, decayed)
                   for stage, grown in enumerate(stages)]
    if capture.get("forced_success_and_decay_transitions") != transitions:
        raise ValueError("Certus growth or budding-block wear changed.")
    harvesting = []
    for silk in (False, True):
        for stage in range(1, 5):
            mature = stage == 4
            harvesting.append({"silk_touch": silk, "stage": stage,
                               "outcome": "PICKED_UP" if mature else "CANT_STORE",
                               "energy_ae": (28 if silk else 6.5) if mature else 0,
                               "block_removed": mature,
                               "accepted": [{"item": "ae2:quartz_cluster" if silk else "ae2:certus_quartz_crystal",
                                             "amount": 1 if silk else 4}] if mature else []})
    if capture.get("filtered_plane_harvesting") != harvesting:
        raise ValueError("Filtered certus harvesting changed.")
    if capture.get("storage_insertion") != [{"items": 1, "energy_ae": 1}, {"items": 4, "energy_ae": 4}]:
        raise ValueError("AE2 storage insertion energy changed.")
    return capture


def verify_farms(farms):
    if len(farms) != 2 or [farm["silk_touch"] for farm in farms] != [False, True]:
        raise ValueError("Both plain and Silk Touch farm measurements are required.")
    for farm in farms:
        for field, expected in {"cables": 24, "planes": 5, "nodes": 33, "active_planes": 5,
                                "accelerator_powered": True, "growth_tag": True,
                                "network_idle_ae_per_tick": 15.546875, "accelerator_remaining_local_ae": 0}.items():
            if farm.get(field) != expected:
                raise ValueError(f"Placed certus farm changed: {field}")
        count = 1 if farm["silk_touch"] else 4
        harvests = farm["output_items"] / count
        expected_energy = farm["ticks"] * 15.546875 + harvests * (29 if farm["silk_touch"] else 10.5)
        if abs(farm["energy_ae"] - expected_energy) > 0.001:
            raise ValueError("Measured farm power does not match idle, harvest, and insertion costs.")
        expected_harvests = farm["ticks"] / 240
        if farm["ticks"] < 600000 or abs(harvests / expected_harvests - 1) > 0.05:
            raise ValueError("Measured farm output differs from the expected stochastic rate by more than 5%.")
    return farms


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    probes = json.loads((args.capture / "machines.json").read_text(encoding="utf-8"))
    report = {"pack": "StaTech Industry 2.0.1", "ae2_version": "19.2.17",
              "certus_growth": verify_certus(probes["certus_growth"]),
              "certus_farms": verify_farms(probes["certus_farms"])}
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Verified sixteen growth branches, eight filtered harvests, accelerator drain, and storage insertion.")
