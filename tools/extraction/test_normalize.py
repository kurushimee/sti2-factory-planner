import unittest

from normalize import ingredient, normalize_recipe, Unsupported


class NormalizationTests(unittest.TestCase):
    def recipe(self, recipe):
        return normalize_recipe({"id": "test:recipe", "origin": "recipe_manager", "recipe": recipe},
                                {"item:c:metal": ["test:b", "test:a"]})

    def test_shaped_quantities_and_alternatives(self):
        result = self.recipe({"type": "minecraft:crafting_shaped", "pattern": ["AA", " B"],
                              "key": {"A": {"tag": "c:metal"}, "B": {"item": "test:tool"}},
                              "result": {"id": "test:result", "count": 4}})
        self.assertEqual(result["inputs"][0]["amount"], 2)
        self.assertEqual(result["inputs"][0]["choices"], ["item:test:a", "item:test:b"])
        self.assertEqual(result["outputs"][0]["amount"], 4)
        self.assertIn("crafting_remainders", result["requirements"])

    def test_catalysts_and_expected_outputs_remain_distinct(self):
        result = self.recipe({"type": "test:greenhouse", "eu": 8, "duration": 1200,
                              "item_inputs": [{"item": "test:seed", "probability": 0}],
                              "item_outputs": [{"item": "test:seed", "probability": 0.5}],
                              "process_conditions": [{"type": "test:condition"}]})
        self.assertEqual(result["inputs"][0]["role"], "catalyst")
        self.assertEqual(result["outputs"][0]["probability"], 0.5)
        self.assertEqual(len(result["conditions"]), 1)

    def test_custom_predicates_are_not_discarded(self):
        raw = {"type": "test:machine", "eu": 2, "duration": 20,
               "item_inputs": [{"type": "neoforge:components", "items": "test:a", "components": {}}]}
        result = self.recipe(raw)
        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(result["raw"], raw)

    def test_empty_tags_and_invalid_probabilities_fail_explicitly(self):
        with self.assertRaises(Unsupported):
            ingredient({"tag": "c:missing"}, "item", {})
        with self.assertRaises(ValueError):
            self.recipe({"type": "test:machine", "eu": 2, "duration": 20,
                         "item_outputs": [{"item": "test:a", "probability": 1.1}]})

    def test_list_ingredient_is_one_slot(self):
        result = self.recipe({"type": "minecraft:crafting_shapeless",
                              "ingredients": [[{"item": "test:a"}, {"item": "test:b"}]],
                              "result": {"id": "test:result"}})
        self.assertEqual(len(result["inputs"]), 1)
        self.assertEqual(result["inputs"][0]["amount"], 1)


if __name__ == "__main__":
    unittest.main()
