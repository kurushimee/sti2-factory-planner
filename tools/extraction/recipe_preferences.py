"""Find released recipes with exactly equal normalized material requirements."""

from collections import defaultdict
from fractions import Fraction


def material_signature(recipe):
    if any(recipe.get(key) for key in ("unsupported", "catalysts", "conditions", "tool_usage", "expected_yields")):
        return None
    totals = {}
    for direction in ("inputs", "outputs"):
        values = defaultdict(Fraction)
        for flow in recipe[direction]:
            if not flow.get("resource") or "choices" in flow or "returns" in flow or flow.get("probability", 1) != 1:
                return None
            values[flow["resource"]] += Fraction(str(flow["amount"]))
        totals[direction] = values
    if not totals["outputs"]:
        return None
    reference = totals["outputs"][sorted(totals["outputs"])[0]]
    return tuple(tuple((resource, amount / reference) for resource, amount in sorted(totals[direction].items()))
                 for direction in ("inputs", "outputs"))


def crafting_preferences(recipes):
    crafting = defaultdict(list)
    for recipe in recipes:
        signature = material_signature(recipe)
        if signature and recipe.get("process", {}).get("type") == "planner:crafting":
            crafting[signature].append(recipe["id"])
    preferences = []
    for recipe in recipes:
        if recipe.get("process", {}).get("type") != "modern_industrialization:assembler":
            continue
        for preferred in crafting.get(material_signature(recipe), []):
            preferences.append({"preferred": preferred, "alternative": recipe["id"],
                                "reason": "Ordinary crafting uses the same materials for the same outputs."})
    return sorted(preferences, key=lambda value: (value["alternative"], value["preferred"]))
