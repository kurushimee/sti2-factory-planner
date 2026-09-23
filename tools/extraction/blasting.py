"""Adapt the distinct loaded blasting recipes measured in a real furnace."""

from prepare_blasting_fixture import distinct_blasting


def blasting_catalog(capture, report, names):
    source = [{"id": entry["source_id"], "recipe": entry["raw"]} for entry in capture["recipes"]
              if entry["type"] in {"minecraft:blasting", "minecraft:smelting"}]
    selected = distinct_blasting({"recipes": source})
    trials = report["trials"]
    if len(trials) != len(selected):
        raise ValueError("The loaded blasting trial count changed.")
    measured = {trial["recipe"]: trial for trial in trials}
    if set(measured) != {trial["recipe"] for trial in selected}:
        raise ValueError("The loaded blasting trials do not match the selected recipes.")
    burn_ticks = {}
    for trial in selected:
        actual = measured[trial["recipe"]]
        for field in ("input", "fuel", "output"):
            if actual[field] != trial[field]:
                raise ValueError("The loaded blasting trial changed " + field + ": " + trial["recipe"])
        if actual["completion_tick"] != trial["cooking_ticks"] or actual["output_count"] != trial["count"]:
            raise ValueError("The loaded blast-furnace result changed: " + trial["recipe"])
        if actual["fuel_slot"] != trial.get("fuel_remainder", "minecraft:air"):
            raise ValueError("The loaded blast-furnace fuel remainder changed: " + trial["recipe"])
        remaining = actual["burn_time_remaining_ticks"]
        duration = remaining + actual["completion_tick"] - 1
        if duration <= 0 or actual["itemstack_burn_ticks"] != duration * 2:
            raise ValueError("The loaded blast-furnace fuel duration changed: " + trial["recipe"])
        previous = burn_ticks.setdefault(trial["fuel"], duration)
        if previous != duration:
            raise ValueError("A blast-furnace fuel has inconsistent burn durations.")
    if burn_ticks != {"minecraft:coal": 800, "minecraft:lava_bucket": 10000}:
        raise ValueError("The verified blast-furnace fuel set changed.")

    machine = {"id": "minecraft:blast_furnace", "status": "supported", "mechanic": "fixed_cycle",
               "recipe_type": "minecraft:blasting", "operation_ticks": 100,
               "fuel_burn_ticks": burn_ticks,
               "assumptions": ["The machine cooks one input at a time and consumes whole fuel items."]}
    recipes = []
    selected = [trial for trial in selected if trial["fuel"] == "minecraft:coal"]
    for trial in selected:
        for fuel, duration in burn_ticks.items():
            ingredient = "item:" + trial["input"]
            fuel_resource = "item:" + fuel
            output = "item:" + trial["output"]
            identity = "minecraft:blasting|" + trial["recipe"] + "|fuel:" + fuel
            fuel_input = {"resource": fuel_resource, "amount": trial["cooking_ticks"] / duration}
            if fuel == "minecraft:lava_bucket":
                fuel_input["returns"] = {fuel_resource: [{"resource": "item:minecraft:bucket", "amount": 1}]}
            fuel_name = "coal" if fuel == "minecraft:coal" else "lava bucket"
            recipes.append({"id": identity, "source_id": trial["recipe"], "origin": "loaded_blast_furnace_ticks",
                            "type": "minecraft:blasting", "name": "Blast " + names.get(output, output) + " with " + fuel_name,
                            "primary": output, "inputs": [{"resource": ingredient, "amount": 1}, fuel_input],
                            "outputs": [{"resource": output, "amount": trial["count"]}],
                            "configurations": [{"id": identity, "machine": machine["id"],
                                                "operations_per_second": 20 / trial["cooking_ticks"],
                                                "capacity": {"operations_per_second": 20 / trial["cooking_ticks"],
                                                             "ticks_per_batch": trial["cooking_ticks"],
                                                             "completion_ticks": [trial["cooking_ticks"]],
                                                             "warmup_ticks": 0, "eu_per_operation": 0,
                                                             "peak_eu_per_tick": 0, "average_full_load_eu_per_tick": 0},
                                                "build_requirements": [{"resource": "item:minecraft:blast_furnace", "amount": 1}],
                                                "startup_profile": {"kind": "vanilla_furnace", "ingredient_resource": ingredient,
                                                                    "fuel_resource": fuel_resource,
                                                                    **({"fuel_remainder_resource": "item:minecraft:bucket"}
                                                                       if fuel == "minecraft:lava_bucket" else {}),
                                                                    "first_completion_ticks": trial["cooking_ticks"]},
                                                "assumptions": ["Fuel consumption is amortized over complete burn cycles at full load. Buffer ingredients and run in bursts when demand is lower.",
                                                                "The first operation needs one whole fuel item before its output is available.",
                                                                *(["The lava bucket was tick-tested with pure iron. This recipe uses the same loaded furnace fuel method, but this exact pairing was not tick-tested."]
                                                                  if fuel == "minecraft:lava_bucket" and trial["recipe"] != "spectrum:blasting/pure_resources/iron" else [])]}]})
    return machine, recipes, {trial["recipe"] for trial in selected}
