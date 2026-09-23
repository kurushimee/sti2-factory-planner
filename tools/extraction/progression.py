"""Derive availability presets from item tasks in the released progression chapters."""

STAGES = ["Getting started", "Steam age", "Electrical age", "Advanced electronics",
          "Digital age", "Space age", "Nuclear age", "Quantum age"]

# Quest hatch tasks accept whole tags, so they cannot establish a useful tier limit.
# These editable defaults follow the pack's casing and cable tiers.
HATCH_STAGES = {"bronze": 2, "steel": 2, "advanced": 3, "turbo": 4, "highly_advanced": 5,
                "lv": 3, "mv": 4, "hv": 5, "ev": 7, "superconductor": 7}


def progression_presets(chapters, machines, upgrades, recipes=()):
    machine_ids = {machine["id"] for machine in machines if machine["status"] == "supported"
                   and machine.get("availability", {}).get("automatic", True)}
    upgrade_ids = {upgrade["id"] for upgrade in upgrades}
    part_ids = {machine["id"] for machine in machines if machine.get("hatch_capacity")}
    seen = set()
    result = []
    conversions = [recipe for recipe in recipes if recipe.get("process", {}).get("type") == "planner:crafting"
                   and not recipe.get("unsupported") and recipe["primary"].removeprefix("item:") in machine_ids]
    crafting = [recipe for recipe in recipes if recipe.get("process", {}).get("type") == "planner:crafting"
                and not recipe.get("unsupported") and not recipe.get("requires_obtained") and recipe.get("inputs")]
    for chapter in sorted(chapters, key=lambda value: value["file"]):
        number = int(chapter["file"].rsplit("/", 1)[-1].split("__", 1)[0])
        seen.update(task["item"] for task in chapter["item_tasks"])
        derived = []
        while True:
            additions = set()
            for recipe in conversions:
                output = recipe["primary"].removeprefix("item:")
                if output in seen:
                    continue
                choices = [{value.removeprefix("item:") for value in flow.get("choices", [flow.get("resource")])}
                           for flow in recipe["inputs"]]
                if choices and all(values & seen for values in choices) and any(values & seen & machine_ids for values in choices):
                    additions.add(output)
                    derived.append({"machine": output, "recipe": recipe["id"]})
            if not additions:
                break
            seen.update(additions)
        name = STAGES[number - 1]
        craftable = set(seen)
        part_sources = []
        while True:
            additions = set()
            for recipe in crafting:
                choices = [{value.removeprefix("item:") for value in flow.get("choices", [flow.get("resource")])}
                           for flow in recipe["inputs"]]
                if not all(values & craftable for values in choices):
                    continue
                for output in recipe.get("outputs", [{"resource": recipe["primary"]}]):
                    identity = output["resource"].removeprefix("item:")
                    if identity not in craftable:
                        additions.add(identity)
                        if identity in part_ids:
                            part_sources.append({"part": identity, "recipe": recipe["id"]})
            if not additions:
                break
            craftable.update(additions)
        for machine in machines:
            required_items = set(machine.get("availability_items", []))
            if required_items and required_items <= seen:
                seen.add(machine["id"])
        result.append({"id": "statech:stage_" + str(number), "name": name,
                       "description": "Quest-listed machines and upgrades through " + name + ", including crafting conversions. Hatch defaults follow casing and cable tiers and can be changed individually.",
                       "available_machines": sorted(machine_ids & seen), "available_upgrades": sorted(upgrade_ids & seen),
                       "available_parts": sorted((part_ids & craftable) | {identity for identity in part_ids
                           if any(number >= stage and identity.startswith("modern_industrialization:" + tier + "_")
                                  for tier, stage in HATCH_STAGES.items())}),
                       "source": {"chapter": chapter["id"], "file": chapter["file"], "derived_conversions": derived,
                                  "derived_parts": part_sources, "hatch_tier_defaults": HATCH_STAGES}})
    if chapters:
        result.append({"id": "statech:all", "name": "All available machines",
                       "description": "Enable supported machines and upgrades outside the main quest chapters, excluding removed and development-only machines. Replication still needs obtained templates.",
                       "available_machines": sorted(machine_ids), "available_upgrades": sorted(upgrade_ids),
                       "available_parts": sorted(part_ids)})
    return result
