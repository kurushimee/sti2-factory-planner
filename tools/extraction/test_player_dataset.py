import unittest

from player_dataset import crafting_adapter, utility_recipes


class PlayerDatasetTests(unittest.TestCase):
    def test_replication_requires_a_retained_obtained_template_and_skips_blacklisted_items(self):
        capture = {"machine_rules": [{"id": "test:replicator", "replication": True, "operation_ticks": 20,
                                    "uu_matter_per_item": 100}],
                   "resources": [{"id": "item:test:allowed", "item_rules": {"replicable": True}},
                                 {"id": "item:test:blocked", "item_rules": {"replicable": False}}]}
        recipes = utility_recipes(capture)
        self.assertEqual(len(recipes), 1)
        recipe = recipes[0]
        self.assertEqual(recipe["requires_obtained"], ["item:test:allowed"])
        self.assertTrue(recipe["replication"])
        self.assertEqual(recipe["inputs"][0]["amount"], 100)
        self.assertEqual(recipe["configurations"][0]["startup_inputs"], [{"resource": "item:test:allowed", "amount": 1}])

    def test_pumps_and_boilers_preserve_fuel_returns_and_obtained_requirements(self):
        capture = {"machine_rules": [
            {"id": "test:pump", "mechanic": "fixed_cycle", "water_multiplier": 2, "operation_ticks": 100,
             "energy_resource": "fluid:modern_industrialization:steam"},
            {"id": "test:boiler", "mechanic": "mi_boiler", "eu_per_burn_tick": 20, "item_fuel_multiplier": 1,
             "steam_to_water": 16, "max_eu_per_tick": 8}],
            "resources": [{"id": "item:test:fuel", "item_rules": {"burn_ticks": 1600,
                           "crafting_remainder": {"id": "test:container", "count": 1}}},
                          {"id": "item:create:creative_blaze_cake", "item_rules": {"burn_ticks": 2147483647}}]}
        recipes = utility_recipes(capture)
        pump = next(value for value in recipes if value["id"] == "water_pumping|test:pump|8")
        self.assertEqual(pump["outputs"][0]["amount"], 2000)
        self.assertEqual(pump["inputs"][0]["amount"], 100)
        boiler = next(value for value in recipes if value["id"] == "boiling|test:boiler|32000")
        self.assertEqual(boiler["inputs"][0]["returns"]["item:test:fuel"], [{"resource": "item:test:container", "amount": 1}])
        self.assertEqual(boiler["inputs"][0]["amount"], 1 / 32000)
        self.assertEqual(boiler["inputs"][1]["amount"], 1 / 16)
        creative = next(value for value in recipes if value.get("requires_obtained"))
        self.assertEqual(creative["requires_obtained"], ["item:create:creative_blaze_cake"])

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
