"""Compile loaded Crystallarieum growth facts without inventing farm capacity."""

import math


FARM_MACHINE_ID = "spectrum:crystallarieum_turtle_farm"

UNSUPPORTED_FARM = (
    "The loaded growth rule fixes crop timing, inputs, and the exact expected harvest, "
    "but the autonomous turtle harvest and restart have no source-derived cycle time. "
    "This route cannot be sized until its complete machine cycle is established."
)


def farm_machine():
    return {
        "id": FARM_MACHINE_ID,
        "status": "unsupported",
        "mechanic": "fixed_cycle",
        "recipe_type": "spectrum:crystallarieum_growing",
        "assumptions": [UNSUPPORTED_FARM],
    }


def operating_rule(seconds_per_stage, stage_count, ink_tier, acceleration, ink_modifier, chance):
    stage_progress = int(20 * acceleration)
    if (not isinstance(seconds_per_stage, int) or seconds_per_stage <= 0
            or stage_count < 2 or ink_tier <= 0 or stage_progress <= 0
            or ink_modifier <= 0 or not 0 <= chance <= 1):
        raise ValueError("The growth timing or additive modifier is unsupported.")
    steps_per_stage = math.ceil(seconds_per_stage * 20 / stage_progress)
    total_steps = steps_per_stage * (stage_count - 1)
    growth_ticks = total_steps * 20
    return {
        "growth_ticks": growth_ticks,
        "ink_per_operation": ink_tier * ink_tier * acceleration * ink_modifier * total_steps,
        "additive_per_operation": chance * total_steps,
    }


def ingredient_flow(ingredient, tags, resource_ids):
    if set(ingredient) == {"item"}:
        choices = ["item:" + ingredient["item"]]
    elif set(ingredient) == {"tag"}:
        choices = ["item:" + item for item in tags.get("item:" + ingredient["tag"], [])]
    else:
        raise ValueError("The loaded growth ingredient needs a separate adapter: " + str(ingredient))
    if not choices or any(choice not in resource_ids for choice in choices):
        raise ValueError("A loaded growth ingredient has no supported resource: " + str(ingredient))
    return {"resource": choices[0], "amount": 1} if len(choices) == 1 else {
        "choices": choices, "amount": 1}


def growth_variants(runtime, growth_report, resource_ids):
    loaded = {entry["id"]: entry["recipe"] for entry in runtime["recipes"]
              if entry.get("recipe", {}).get("type") == "spectrum:crystallarieum_growing"}
    harvests = {entry["recipe"]: entry for entry in growth_report["growth_recipes"]}
    if len(loaded) != 20 or loaded.keys() != harvests.keys():
        raise ValueError("The loaded growth recipes differ from the verified 20-recipe harvest set.")
    recipes = []
    for source_id, source in sorted(loaded.items()):
        stages = source["growth_stage_states"]
        harvest = harvests[source_id]
        if (len(stages) != 3 or stages[-1]["Name"] != harvest["cluster"]
                or harvest["yield_range"] != [3, 5]
                or source.get("grows_without_additive", False)
                or len(source.get("additives", [])) == 0):
            raise ValueError("A growth recipe needs a separately verified behavior: " + source_id)
        starter = ingredient_flow(source["ingredient"], runtime["tags"], resource_ids)
        output = "item:" + harvest["ordinary_harvest"]
        ink = "ink:" + source["ink_color"]
        fluid = "fluid:" + source["fluid"]["fluid"]
        seconds = source["seconds_per_growth_stage"]
        tier = source["ink_cost_tier"]
        if (not isinstance(seconds, int) or seconds <= 0 or not isinstance(tier, int)
                or tier <= 0 or any(resource not in resource_ids for resource in (output, ink, fluid))):
            raise ValueError("The loaded growth outputs or timing are unsupported: " + source_id)
        for index, additive in enumerate(source["additives"]):
            additive_flow = ingredient_flow(additive["ingredient"], runtime["tags"], resource_ids)
            acceleration = additive["growth_acceleration_mod"]
            ink_modifier = additive["ink_consumption_mod"]
            chance = additive["consume_chance_per_second"]
            rule = operating_rule(seconds, len(stages), tier, acceleration, ink_modifier, chance)
            growth_ticks = rule["growth_ticks"]
            additive_flow["amount"] = rule["additive_per_operation"]
            recipe_id = source_id + "|additive:" + str(index)
            output_name = harvest["ordinary_harvest"].split(":", 1)[1].replace("_", " ").title()
            additive_name = (additive_flow.get("resource") or additive_flow["choices"][0]).split(":", 2)[2]
            additive_name = additive_name.replace("_", " ").title()
            recipes.append({
                "id": recipe_id,
                "name": "Grow " + output_name + " with " + additive_name,
                "group": "Resources",
                "source_id": source_id,
                "origin": "loaded_growth_and_harvest_rules",
                "type": "spectrum:crystallarieum_growing",
                "primary": output,
                "inputs": [starter, additive_flow, {
                    "resource": ink, "amount": rule["ink_per_operation"]}],
                "outputs": [{"resource": output, "amount": 4}],
                "expected_yields": True,
                "yield_range": [3, 5],
                "configurations": [],
                "unsupported": UNSUPPORTED_FARM,
                "assumptions": [
                    f"The loaded growth rule takes {growth_ticks} ticks with this additive, excluding harvesting and restart.",
                    "The harvest expectation is exactly four items because the loaded loot rule draws uniformly from three, four, and five. An individual harvest is not fixed at four.",
                    f"The machine checks for one thousand millibuckets of {fluid} without draining it; this is retained startup stock.",
                ],
            })
    return recipes
