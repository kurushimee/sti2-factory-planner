"""Map captured machine families to mechanics supported by the calculation kernel."""


def machine_rules(capture, upgrades):
    rules = []
    simple = {"ElectricCraftingMachineBlockEntity", "SteamCraftingMachineBlockEntity",
              "ElectricCraftingMultiblockBlockEntity", "SteamCraftingMultiblockBlockEntity",
              "FusionReactorBlockEntity", "ElectricBlastFurnaceBlockEntity", "DistillationTowerBlockEntity"}
    batching = {"ElectricMultipliedCraftingMultiblockBlockEntity", "SteamMultipliedCraftingMultiblockBlockEntity",
                "LargeElectricFurnaceBlockEntity", "PyrolyseOvenBlockEntity"}
    for machine in capture:
        family = machine["class"].rsplit(".", 1)[-1]
        record = {"id": machine["id"], "recipe_type": machine.get("recipe_type"),
                  "source_class": machine["class"], "status": "unsupported"}
        if machine.get("shapes"):
            record["shapes"] = machine["shapes"]
        if machine.get("role") == "multiblock_part":
            record.update(status="structural", role="multiblock_part", hatch_type=machine.get("hatch_type"),
                          upgrades_steam_to_steel=machine.get("upgrades_steam_to_steel", False),
                          hatch_capacity=machine.get("hatch_capacity", {}))
        elif machine.get("tesla_tower_probe"):
            names = ["Copper", "Electrum", "Aluminum", "Annealed copper", "Superconductor"]
            record.update(status="infrastructure", mechanic="passive_infrastructure", infrastructure=[{
                "id": str(tier["shape"]), "name": names[tier["shape"]] + " Tesla tower",
                "shape": tier["shape"], "passive_eu_per_tick": tier["passive_eu_per_tick"],
                "structure": {"shape": tier["shape"], "energy_input": True},
                "default_energy_hatch": "modern_industrialization:" + ["lv", "mv", "hv", "ev", "superconductor"][tier["shape"]] + "_energy_input_hatch",
                "max_transfer_eu_per_tick": tier["max_transfer_eu_per_tick"], "max_axis_distance": tier["max_axis_distance"],
                "assumptions": ["The formed tower stays enabled and fully supplied, even when no receivers need power.",
                    "Transfer and range are per tower. Receiver placement, same-tier energy hatches, and network reachability need separate verification.",
                    "Transmitted energy is already charged to consuming machines; only the tower drain is extra overhead."]
                } for tier in machine["tesla_tower_probe"]["tiers"]],
                infrastructure_evidence=machine["tesla_tower_probe"])
        elif machine.get("storage_probe"):
            probe = machine["storage_probe"]
            capacity = probe["capacity_eu"]
            limit = probe["cable_limit_eu_per_tick"]
            if capacity != 100000 * probe["nominal_tier_eu"] or limit <= 0:
                raise ValueError("The loaded storage capacity or transfer limit is inconsistent.")
            if probe["charge_eu_over_20_ticks"] != 20 * limit or probe["discharge_eu_over_20_ticks"] != 20 * limit:
                raise ValueError("The loaded storage transfer samples do not match the stated limit.")
            record.update(status="infrastructure", mechanic="energy_storage", storage={
                "capacity_eu": capacity, "charge_eu_per_tick": limit,
                "discharge_eu_per_tick": limit, "loss_eu_per_tick": 0,
                "saved_charge_field": "storedEu",
                "basis": "Loaded storage adapters on a one-node cable network; a placed cable topology is not established."})
        elif machine.get("water_pump_probe"):
            record.update(status="supported", mechanic="fixed_cycle", **machine["water_pump_probe"])
        elif machine.get("waste_collector_probe"):
            probe = machine["waste_collector_probe"]
            sample = next(value for value in probe["samples"] if value["animals"] == 1)
            record.update(status="supported", mechanic="fixed_cycle", waste_collection=True,
                          operation_ticks=sample["deliveries"][0]["tick"], output_mb=sample["deliveries"][0]["amount_mb"],
                          energy_per_tick=sample["energy_consumed"] / probe["test_ticks"], energy_resource=sample["energy_resource"],
                          waste_collection_evidence=probe)
        elif machine.get("replication_probe"):
            probe = machine["replication_probe"]
            record.update(status="supported", mechanic="fixed_cycle", operation_ticks=probe["deliveries"][0]["tick"],
                          replication=True, uu_matter_per_item=probe["uu_matter_consumed"] / sum(entry["items"] for entry in probe["deliveries"]))
        elif machine.get("recipe_generation_probe"):
            record.update(status="supported", mechanic="fixed_cycle", energy_generation=True,
                          generation_evidence=machine["recipe_generation_probe"])
            if machine["id"] == "yet_another_industrialization:dragon_egg_energy_siphon":
                record["build_inputs"] = [{"resource": "item:minecraft:dragon_egg", "amount": 1}]
        elif machine.get("irradiation_probe"):
            nuclear_hatches = sum("modern_industrialization:nuclear_item" in cell["allowed_hatches"]
                                 for cell in machine["shapes"][0]["cells"])
            if nuclear_hatches != max(sample["hatches"] for sample in machine["irradiation_probe"]):
                raise ValueError("The irradiation probe and structure hatch limit disagree.")
            record.update(status="supported", mechanic="irradiator", nuclear_hatch_limit=nuclear_hatches,
                          irradiation_evidence=machine["irradiation_probe"])
        elif family in {"BoilerMachineBlockEntity", "SteamBoilerMultiblockBlockEntity"}:
            heater = machine["component_fields"]["aztech.modern_industrialization.machines.components.SteamHeaterComponent"]
            burner = machine["component_fields"]["aztech.modern_industrialization.machines.components.FuelBurningComponent"]
            record.update(status="supported", mechanic="mi_boiler", max_eu_per_tick=heater["SteamHeaterComponent.maxEuProduction"],
                          eu_per_degree=heater["SteamHeaterComponent.euPerDegree"], temperature_max=heater["TemperatureComponent.temperatureMax"],
                          continuous=heater["SteamHeaterComponent.requiresContinuousOperation"],
                          item_fuel_multiplier=burner["FuelBurningComponent.burningItemEuMultiplier"],
                          eu_per_burn_tick=burner["FuelBurningComponent.EU_PER_BURN_TICK"], steam_to_water=heater["SteamHeaterComponent.STEAM_TO_WATER"])
            record["eu_per_steam_mb"] = 8 if heater["SteamHeaterComponent.acceptHighPressure"] and not heater["SteamHeaterComponent.acceptLowPressure"] else 1
            if family == "SteamBoilerMultiblockBlockEntity":
                probe = machine.get("coal_warmup_probe", {})
                if not probe.get("hot_running_probe"):
                    record.update(status="unsupported", mechanic="unverified_boiler", reason="The large boiler needs its loaded hot-running output and fuel probe.")
                else:
                    record["hot_running_probe"] = probe["hot_running_probe"]
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
                if machine.get("batch_tiers"):
                    record["batch_tiers"] = machine["batch_tiers"]
                    record["batch_limit"] = max(tier["batch_limit"] for tier in machine["batch_tiers"])
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
