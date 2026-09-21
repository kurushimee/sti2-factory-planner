import unittest

from recipe_preferences import crafting_preferences, material_signature


def recipe(identity, kind, amount=1, output=1):
    return {"id": identity, "process": {"type": kind}, "inputs": [{"resource": "ore", "amount": amount}],
            "outputs": [{"resource": "part", "amount": output}]}


class RecipePreferenceTests(unittest.TestCase):
    def test_only_equal_material_assembly_gets_a_crafting_preference(self):
        records = [recipe("craft", "planner:crafting"), recipe("assembly", "modern_industrialization:assembler", 4, 4),
                   recipe("efficient", "modern_industrialization:assembler", 1, 4)]
        preferences = crafting_preferences(records)
        self.assertEqual([(value["preferred"], value["alternative"]) for value in preferences], [("craft", "assembly")])

    def test_exact_decimals_combine_without_binary_roundoff(self):
        split = recipe("split", "planner:crafting", 0.1, 0.3)
        split["inputs"].append({"resource": "ore", "amount": 0.2})
        self.assertEqual(material_signature(split), material_signature(recipe("whole", "planner:crafting")))

    def test_conditions_and_returned_ingredients_need_separate_evidence(self):
        value = recipe("special", "planner:crafting")
        value["conditions"] = [{"type": "biome"}]
        self.assertIsNone(material_signature(value))
        value.pop("conditions")
        value["inputs"][0]["returns"] = {}
        self.assertIsNone(material_signature(value))
