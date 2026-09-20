"""Build the portable planning catalog from the verified intermediate capture."""

import argparse
from collections import Counter
import json
from pathlib import Path
from normalize import resource_identity


def crafting_adapter(entry, record, capture, resources, variants):
    evidence = next((value for value in capture.get("crafting_rules", {}).get("recipes", []) if value["id"] == entry["source_id"]), None)
    standard = {"net.minecraft.world.item.crafting.ShapedRecipe", "net.minecraft.world.item.crafting.ShapelessRecipe",
                "dev.latvian.mods.kubejs.recipe.special.ShapedKubeJSRecipe", "dev.latvian.mods.kubejs.recipe.special.ShapelessKubeJSRecipe"}
    if not evidence or evidence.get("unavailable") or evidence.get("class") not in standard:
        return "This crafting recipe needs a matching runtime automation check."
    if entry["raw"].get("kubejs:ingredient_actions"):
        return "This recipe changes its tools and needs a durability adapter."
    if entry["raw"].get("kubejs:modify_result"):
        return "This recipe changes its result through a script."
    if evidence.get("output") != entry["raw"]["result"]:
        return "The captured crafting result differs from the declared output."
    for flow in record["inputs"]:
        returns = {}
        for choice in flow.get("choices", [flow.get("resource")]):
            item = resources.get(choice, {})
            if "components" in item or "item_rules" not in item:
                return "The ingredient component variant needs a crafting-remainder check."
            remainder = item["item_rules"].get("crafting_remainder")
            if remainder:
                identity = resource_identity("item", remainder["id"], remainder.get("components"), variants)
                returns[choice] = [{"resource": identity, "amount": remainder.get("count", 1)}]
        if returns:
            flow["returns"] = returns
    record["process"] = {"type": "planner:crafting"}
    record["crafting_evidence"] = {"class": evidence["class"], "remainder_implementations": evidence["remainder_implementations"]}
    return None


def build_dataset(capture):
    resource_index = {entry["id"]: entry for entry in capture["resources"]}
    variants = {}
    resources = [{key: value for key, value in entry.items() if key != "item_rules"}
                 for entry in capture["resources"]]
    resources.append({"id": "energy:eu", "name": "Electricity", "kind": "energy", "unit": "EU"})
    names = {entry["id"]: entry.get("name", entry["id"].split(":", 1)[-1].replace("_", " ")) for entry in resources}
    recipes = []
    unsupported = []
    for entry in capture["recipes"]:
        record = {key: entry[key] for key in ("id", "source_id", "type", "origin")}
        if entry["status"] != "normalized":
            unsupported.append({**record, "reason": entry["reason"]})
            continue
        inputs, outputs, catalysts = [], [], []
        for direction, target in (("inputs", inputs), ("outputs", outputs)):
            for flow in entry[direction]:
                if flow["role"] == "catalyst":
                    catalysts.append({"choices": flow["choices"], "amount": flow["amount"]})
                    continue
                amount = flow["amount"] * flow["probability"]
                if not amount:
                    continue
                identity = {"resource": flow["choices"][0]} if len(flow["choices"]) == 1 else {"choices": flow["choices"]}
                target.append({**identity, "amount": amount, "nominal_amount": flow["amount"], "probability": flow["probability"]})
        if not outputs:
            unsupported.append({**record, "reason": "The recipe has no positive material output."})
            continue
        primary = outputs[0]["resource"]
        record.update(name=names[primary], primary=primary, inputs=inputs, outputs=outputs,
                      configurations=[], catalysts=catalysts, conditions=entry.get("conditions", []),
                      expected_yields=any(flow["probability"] not in (0, 1) for flow in entry["inputs"] + entry["outputs"]))
        if entry["mechanic"] == "mi_recipe":
            record["process"] = {"duration_ticks": entry["duration_ticks"], "eu_per_tick": entry["eu_per_tick"], "type": entry["type"]}
        else:
            reason = crafting_adapter(entry, record, capture, resource_index, variants)
            if reason:
                record["unsupported"] = reason
        if any(flow.get("matching_scope") for flow in entry["inputs"]):
            record["unsupported"] = "This custom ingredient currently has only displayed-variant evidence."
        recipes.append(record)
    for machine in capture["machine_rules"]:
        if machine.get("mechanic") != "buffered_fuel_generator":
            continue
        for fuel in machine["fuels"]:
            if fuel["eu_per_unit"] <= 0:
                continue
            identity = "generation|" + machine["id"] + "|" + fuel["resource"]
            recipes.append({"id": identity, "name": names.get("item:" + machine["id"], machine["id"]),
                            "source_id": machine["id"], "type": "planner:buffered_fuel_generation", "origin": "loaded_fuel_component",
                            "primary": "energy:eu", "group": "Power", "inputs": [{"resource": fuel["resource"], "amount": 1}],
                            "outputs": [{"resource": "energy:eu", "amount": fuel["eu_per_unit"]}],
                            "configurations": [{"id": identity, "machine": machine["id"],
                                                "operations_per_second": machine["max_eu_per_tick"] * 20 / fuel["eu_per_unit"],
                                                "build_requirements": [{"resource": "item:" + machine["id"], "amount": 1}]}]})
    upgrades = [{"id": key, "extra_max_eu": value["extraMaxEu"]}
                for key, value in capture["data_maps"]["modern_industrialization:machine_upgrades"].items()]
    upgrades.append({"id": "ae2:speed_card", "extra_max_eu": 0})
    machines = [*capture["machine_rules"], {"id": "ae2:molecular_assembler", "status": "supported", "mechanic": "ae_molecular_assembler",
                "recipe_type": "planner:crafting", "upgrades": ["ae2:speed_card"], "upgrade_limit": 5,
                "eu_per_ae": capture["power_units"]["fe_per_ae"] / capture["power_units"]["fe_per_eu"],
                "usage_multiplier": capture["power_units"]["ae_usage_multiplier"]}]
    resources.extend(value for key, value in variants.items() if key not in resource_index)
    return {"format": 1, "identity": capture["identity"], "name": "StaTech Industry 2.0.1",
            "complete": False, "description": "Captured StaTech recipes with explicit adapter coverage. Development catalog.",
            "resources": resources, "recipes": recipes, "machines": machines, "upgrades": upgrades,
            "default_machines": [machine["id"] for machine in machines
                                 if machine["status"] == "supported" and machine.get("mechanic") != "mi_array"],
            "unsupported_entries": unsupported, "loaded_mods": capture["loaded_mods"],
            "source": {"pack_version": "2.0.1", "capture_format": capture["format"], "capture_version": capture["version"]}}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    dataset = build_dataset(json.loads(args.input.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"recipes": len(dataset["recipes"]), "unsupported_entries": len(dataset["unsupported_entries"]),
                      "adapters": dict(Counter(entry.get("unsupported", "available") for entry in dataset["recipes"]))}))
