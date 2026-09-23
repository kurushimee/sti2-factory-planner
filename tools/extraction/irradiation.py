"""Build irradiation routes from loaded fuel rules and verified component cycles."""


def irradiation_recipes(capture):
    machine = next((value for value in capture["machine_rules"] if value.get("mechanic") == "irradiator"), None)
    if not machine:
        return []
    resources = {value["id"]: value for value in capture["resources"]}
    sources = capture["data_maps"]["yet_another_industrialization:irradiator_neutron_source"]
    recipes = []
    for resource in resources.values():
        fuel = resource.get("item_rules", {}).get("nuclear_fuel")
        if not fuel:
            continue
        for source_id, source in sources.items():
            if source.get("restricted_to"):
                raise ValueError("Restricted neutron sources need a resolved fuel predicate.")
            source_resource = "item:" + source_id
            lifespan = resources[source_resource]["item_rules"]["max_damage"] if source["type"] == "lifespan" else 1
            if source["type"] not in ("consumption", "lifespan") or lifespan <= 0:
                raise ValueError("The neutron source has no verified consumption rule.")
            source_rate = source["probability"] * 20 / source["probability_check_cooldown"] / lifespan
            # A continuously refilled consumable stack does not become empty. A worn-out tool does.
            power = source["eu"] * (1 - source_rate / 20) if source["type"] == "lifespan" else source["eu"]
            ticks = (fuel["disintegrations"] + source["irradiation"] - 1) // source["irradiation"]
            identity = "irradiate|" + resource["id"] + "|" + source_id
            configurations = []
            for count in range(1, machine["nuclear_hatch_limit"] + 1):
                rate = count * 20 / ticks
                configurations.append({"id": identity + "|hatches:" + str(count), "machine": machine["id"],
                    "name": str(count) + (" nuclear hatch" if count == 1 else " nuclear hatches"),
                    "operations_per_second": rate, "idle_eu_per_tick": power, "build_cost": 1 + count,
                    "build_requirements": [{"resource": "item:" + machine["id"], "amount": 1}], "setup": {"batch": count},
                    "capacity": {"operations_per_second": rate, "ticks_per_batch": ticks,
                                 "peak_eu_per_tick": source["eu"], "average_full_load_eu_per_tick": power,
                                 "eu_per_operation": power * ticks / count, "warmup_ticks": 0, "completion_ticks": [ticks]},
                    "operating_points": [{"operations_per_second": output,
                        "inputs": [{"resource": source_resource, "amount": source_rate}]} for output in [0, rate]],
                    "startup_profile": {"kind": "irradiator", "source_resource": source_resource, "source_per_second": source_rate,
                                        "fuel_resource": resource["id"], "batch": count, "cycle_ticks": ticks, "discovery_delay_ticks": 59},
                    "assumptions": ["Each nuclear hatch runs one fuel rod. Hatches are supplied and emptied continuously.",
                        "Power and neutron-source use continue while the enabled irradiator is idle. Disable it to stop these costs.",
                        "Source consumption is the exact long-run expectation from the loaded chance and cooldown; an individual time window can differ. Keep consumable source stacks refilled.",
                        "A worn-out neutron-source tool has an uncharged final tick. Its average power includes that tick.",
                        "Initial source discovery can take up to 59 extra ticks before irradiation begins."]})
            recipes.append({"id": identity, "name": "Irradiate " + resource.get("name", resource["id"]) + " with " +
                            resources[source_resource].get("name", source_id), "type": "planner:irradiation",
                            "origin": "loaded_irradiation_components", "source_id": machine["id"],
                            "primary": "item:" + fuel["product"], "inputs": [{"resource": resource["id"], "amount": 1}],
                            "outputs": [{"resource": "item:" + fuel["product"], "amount": fuel["product_amount"]}],
                            "configurations": configurations})
    return recipes
