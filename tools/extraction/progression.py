"""Derive availability presets from item tasks in the released progression chapters."""

STAGES = ["Getting started", "Steam age", "Electrical age", "Advanced electronics",
          "Digital age", "Space age", "Nuclear age", "Quantum age"]


def progression_presets(chapters, machines, upgrades, recipes=()):
    machine_ids = {machine["id"] for machine in machines if machine["status"] == "supported"}
    upgrade_ids = {upgrade["id"] for upgrade in upgrades}
    seen = set()
    result = []
    conversions = [recipe for recipe in recipes if recipe.get("process", {}).get("type") == "planner:crafting"
                   and not recipe.get("unsupported") and recipe["primary"].removeprefix("item:") in machine_ids]
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
        result.append({"id": "statech:stage_" + str(number), "name": name,
                       "description": "Quest-listed machines and upgrades through " + name + ", including crafting conversions from those machines. Other entries need individual overrides.",
                       "available_machines": sorted(machine_ids & seen), "available_upgrades": sorted(upgrade_ids & seen),
                       "source": {"chapter": chapter["id"], "file": chapter["file"], "derived_conversions": derived}})
    if chapters:
        result.append({"id": "statech:all", "name": "All supported machines",
                       "description": "Enable every supported machine and upgrade, including entries outside the main quest chapters. Replication still needs obtained templates.",
                       "available_machines": sorted(machine_ids), "available_upgrades": sorted(upgrade_ids)})
    return result
