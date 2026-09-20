"""Map captured machine families to mechanics supported by the calculation kernel."""


def machine_rules(capture, upgrades):
    rules = []
    simple = {"ElectricCraftingMachineBlockEntity", "SteamCraftingMachineBlockEntity",
              "ElectricCraftingMultiblockBlockEntity", "SteamCraftingMultiblockBlockEntity",
              "FusionReactorBlockEntity", "ElectricBlastFurnaceBlockEntity", "DistillationTowerBlockEntity"}
    batching = {"ElectricMultipliedCraftingMultiblockBlockEntity", "SteamMultipliedCraftingMultiblockBlockEntity"}
    for machine in capture:
        family = machine["class"].rsplit(".", 1)[-1]
        record = {"id": machine["id"], "recipe_type": machine.get("recipe_type"),
                  "source_class": machine["class"], "status": "unsupported"}
        if machine.get("role") == "multiblock_part":
            record.update(status="structural", role="multiblock_part", hatch_type=machine.get("hatch_type"),
                          upgrades_steam_to_steel=machine.get("upgrades_steam_to_steel", False))
        elif machine.get("water_pump_probe"):
            record.update(status="supported", mechanic="fixed_cycle", **machine["water_pump_probe"])
        elif family == "BoilerMachineBlockEntity":
            heater = machine["component_fields"]["aztech.modern_industrialization.machines.components.SteamHeaterComponent"]
            burner = machine["component_fields"]["aztech.modern_industrialization.machines.components.FuelBurningComponent"]
            record.update(status="supported", mechanic="mi_boiler", max_eu_per_tick=heater["SteamHeaterComponent.maxEuProduction"],
                          eu_per_degree=heater["SteamHeaterComponent.euPerDegree"], temperature_max=heater["TemperatureComponent.temperatureMax"],
                          continuous=heater["SteamHeaterComponent.requiresContinuousOperation"],
                          item_fuel_multiplier=burner["FuelBurningComponent.burningItemEuMultiplier"],
                          eu_per_burn_tick=burner["FuelBurningComponent.EU_PER_BURN_TICK"], steam_to_water=heater["SteamHeaterComponent.STEAM_TO_WATER"])
        elif family in simple | batching:
            steam = family.startswith("Steam")
            modular = family in batching
            record.update(status="supported", mechanic="mi_batch" if modular else "mi_crafter",
                          base_eu=machine["base_eu"], max_eu=machine["max_eu"],
                          energy_resource="fluid:modern_industrialization:steam" if steam else "energy:eu",
                          upgrades=[] if steam or family == "FusionReactorBlockEntity" else list(upgrades),
                          upgrade_limit=0 if steam or family == "FusionReactorBlockEntity" else 64,
                          batch_limit=machine.get("batch_limit", 1))
            if modular:
                record["energy_multiplier"] = machine["batch_energy_probe_output"] / (machine["batch_limit"] * machine["batch_energy_probe_input"])
            if family == "SteamCraftingMultiblockBlockEntity":
                record["steel_hatch_variant"] = {"base_eu": 4, "max_eu": 4}
            if family == "ElectricBlastFurnaceBlockEntity":
                record["recipe_eu_limits"] = [tier["recipe_eu_limit"] for tier in machine["coil_tiers"]]
                record["coil_tiers"] = machine["coil_tiers"]
            if family == "DistillationTowerBlockEntity":
                record["fluid_output_limits"] = list(range(1, len(machine["shapes"]) + 1))
            record["assumptions"] = ["No temporary steam overclock catalyst or lubricant.",
                                     "The machine has enough input, output, and energy transfer capacity."]
        elif machine.get("array_shape_capacities"):
            eligibility = "processing_array_eligible" if family == "ProcessingArrayBlockEntity" else "multi_processing_array_eligible"
            eligible = [value for value in capture if value.get(eligibility)]
            enabled = machine["array_allows_upgrades"]
            record.update(status="supported", mechanic="mi_array", base_eu=machine["base_eu"], max_eu=machine["max_eu"],
                          shape_capacities=machine["array_shape_capacities"], eligible_machines=[value["id"] for value in eligible],
                          contained_recipe_types={value["id"]: value["recipe_type"] for value in eligible},
                          energy_multiplier=machine["batch_energy_probe_output"] / machine["batch_energy_probe_input"],
                          upgrades=list(upgrades) if enabled else [], upgrade_limit=64 if enabled else 0)
        elif machine.get("fuel_rules"):
            record.update(status="supported", mechanic="buffered_fuel_generator", **machine["fuel_rules"])
        else:
            record["reason"] = "This machine family still needs a verified calculation adapter."
        rules.append(record)
    return rules
