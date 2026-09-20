import unittest

from player_dataset import crafting_adapter


class PlayerDatasetTests(unittest.TestCase):
    def test_crafting_remainders_follow_the_actual_ingredient(self):
        output = {"id": "test:cake", "count": 1}
        entry = {"source_id": "test:cake", "raw": {"result": output}}
        evidence = {"id": "test:cake", "class": "net.minecraft.world.item.crafting.ShapedRecipe",
                    "output": output, "remainder_implementations": ["net.minecraft.world.item.crafting.Recipe"]}
        capture = {"crafting_rules": {"recipes": [evidence]}}
        resources = {"item:test:milk": {"item_rules": {"crafting_remainder": {"id": "test:bucket", "count": 1}}},
                     "item:test:cream": {"item_rules": {}}}
        record = {"inputs": [{"choices": ["item:test:milk", "item:test:cream"], "amount": 3}]}
        self.assertIsNone(crafting_adapter(entry, record, capture, resources, {}))
        self.assertEqual(record["inputs"][0]["returns"], {"item:test:milk": [{"resource": "item:test:bucket", "amount": 1}]})
        entry["raw"]["kubejs:ingredient_actions"] = [{"action": {"damage": 50}}]
        self.assertIn("durability", crafting_adapter(entry, record, capture, resources, {}))

    def test_dynamic_crafting_classes_and_components_need_their_own_evidence(self):
        entry = {"source_id": "test:dynamic", "raw": {"result": {"id": "test:item"}}}
        evidence = {"id": "test:dynamic", "class": "test:CopyComponentsRecipe"}
        self.assertIn("runtime", crafting_adapter(entry, {}, {"crafting_rules": {"recipes": [evidence]}}, {}, {}))


if __name__ == "__main__":
    unittest.main()
