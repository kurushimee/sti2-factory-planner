"""Describe the placed, measured AE2 certus farm without treating found sites as supplies."""

from fractions import Fraction

from normalize import resource_identity
from verify_certus import verify_certus, verify_farms


def certus_catalog(capture):
    if not capture.get("certus_farms"):
        return [], [], []
    rules = verify_certus(capture["certus_growth"])
    farms = verify_farms(capture["certus_farms"])
    conversion = Fraction(str(capture["power_units"]["fe_per_ae"])) / Fraction(
        str(capture["power_units"]["fe_per_eu"]))
    usage = capture["power_units"]["ae_usage_multiplier"]
    if usage != 1:
        raise ValueError("Repeat the whole-network certus power measurements for the changed AE2 multiplier.")
    deposit = "site:flawless_budding_quartz"
    machine = "planner:certus_farm"
    variants = {}
    enchanted = resource_identity("item", "ae2:annihilation_plane",
                                 {"minecraft:enchantments": {"levels": {"minecraft:silk_touch": 1}}}, variants)
    variants[enchanted]["name"] = "Annihilation plane with Silk Touch I"
    resources = [{"id": deposit, "kind": "site", "unit": "blocks",
                  "name": "Flawless budding quartz kept at its original site"}, *variants.values()]
    machines = [{"id": machine, "name": "Five-face certus farm", "status": "supported", "mechanic": "fixed_configurations",
                 "availability_items": ["ae2:growth_accelerator", "ae2:annihilation_plane", "ae2:storage_bus", "ae2:fluix_glass_cable"]}]
    # Each face needs four successes. One of six directions succeeds with probability 1/5 every ten ticks.
    exact_rate = Fraction(5 * 20, 4 * 6 * rules["growth_chance_denominator"] * rules["accelerator_interval_ticks"])
    rate = float(exact_rate)
    recipes = []
    for farm in farms:
        silk = farm["silk_touch"]
        output = "item:ae2:quartz_cluster" if silk else "item:ae2:certus_quartz_crystal"
        identity = "certus_growth|" + ("clusters" if silk else "crystals")
        retained = [{"resource": deposit, "amount": 1}]
        required = [deposit]
        bill = [{"resource": "item:ae2:" + item, "amount": count} for item, count in
                [("growth_accelerator", 1), ("fluix_glass_cable", 24), ("storage_bus", 1),
                 ("energy_cell", 1), ("energy_acceptor", 1)]]
        bill.append({"resource": "item:minecraft:chest", "amount": 1})
        if silk:
            retained.append({"resource": enchanted, "amount": 5})
            required.append(enchanted)
        else:
            bill.append({"resource": "item:ae2:annihilation_plane", "amount": 5})
        idle = Fraction(str(farm["network_idle_ae_per_tick"])) * conversion
        operation_energy = Fraction(29 if silk else 21, 1 if silk else 2) * conversion
        peak = (Fraction(str(farm["network_idle_ae_per_tick"])) +
                5 * Fraction(29 if silk else 21, 1 if silk else 2)) * conversion
        average = idle + exact_rate * operation_energy / 20
        recipes.append({"id": identity, "name": "Grow certus " + ("clusters" if silk else "crystals"),
            "source_id": "ae2:flawless_budding_quartz", "origin": "loaded_certus_farm", "type": "planner:certus_growth",
            "primary": output, "group": "Extraction", "expected_yields": True, "requires_obtained": required,
            "inputs": [], "outputs": [{"resource": output, "amount": 1 if silk else 4}],
            "configurations": [{"id": identity, "machine": machine, "name": "Five planes with " + ("Silk Touch I" if silk else "no enchantments"),
                "operations_per_second": rate, "idle_eu_per_tick": float(idle),
                "eu_per_operation": float(operation_energy), "build_requirements": bill,
                "capacity": {"operations_per_second": rate,
                    "expected_operations_per_second_ratio": {"numerator": str(exact_rate.numerator),
                        "denominator": str(exact_rate.denominator)},
                    "average_full_load_eu_per_tick": float(average),
                    "average_full_load_eu_per_tick_ratio": {"numerator": str(average.numerator),
                        "denominator": str(average.denominator)},
                    "peak_eu_per_tick": float(peak)},
                "startup_inputs": retained,
                "assumptions": [
                    "Build around one existing flawless budding quartz block per farm. Breaking that block degrades it; do not move it.",
                    "Use the measured layout: one accelerator, five planes, 24 glass cables, one filtered storage bus and chest, one energy cell, and one energy acceptor.",
                    "Keep the entire farm ticking, supply FE through its energy acceptor, and continuously empty its output chest.",
                    "The storage bus must accept only the final product. Other storage that accepts immature buds would break the growth cycle.",
                    "Capacity is a long-run expected rate. Natural random ticks are excluded, and no finite buffer guarantees uninterrupted random output.",
                    "The network draws idle power even when output is blocked. Harvest power scales with completed clusters.",
                    "Peak power allows all five mature faces to be harvested in one tick. The energy cell can absorb this short burst.",
                    "Allow for network boot and random first growth before relying on output. A fixed cold-start completion time is not established."]}]})
    return resources, machines, recipes
