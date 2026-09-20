import unittest

from normalize import canonical, flow, ingredient, normalize_recipe, resource_identity, Unsupported


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

    def test_component_variants_share_identity_without_losing_the_predicate(self):
        components = {"minecraft:potion_contents": {"potion": "minecraft:water"}}
        predicate = {"type": "neoforge:components", "items": "minecraft:potion", "components": components}
        resolutions = {canonical(predicate): {"matching_display_stacks": [{"id": "minecraft:potion", "components": components}]}}
        variants = {}
        result = flow({**predicate, "amount": 2}, "item", {}, resolutions=resolutions, variants=variants)
        output = flow({"item": "minecraft:potion", "components": components}, "item", {}, True, variants=variants)
        self.assertEqual(result["choices"], output["choices"])
        self.assertNotEqual(result["choices"], ["item:minecraft:potion"])
        self.assertEqual(result["matching_scope"], "captured_display_variants")
        self.assertEqual(result["amount"], 2)
        self.assertEqual(len(variants), 1)

    def test_component_identity_is_stable_across_object_key_order(self):
        variants = {}
        first = resource_identity("item", "test:item", {"a": 1, "b": 2}, variants)
        second = resource_identity("item", "test:item", {"b": 2, "a": 1}, variants)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
