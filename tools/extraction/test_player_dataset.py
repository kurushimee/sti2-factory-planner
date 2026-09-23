import unittest

from player_dataset import crafting_adapter, utility_recipes, tool_recipe_variants, boiler_operating_points, default_output


class PlayerDatasetTests(unittest.TestCase):
    def test_chemical_recipe_names_select_the_named_product_after_an_acid_coproduct(self):
        for product in ("chloroform", "tetrafluoroethylene"):
            outputs = [{"resource": "fluid:modern_industrialization:hydrochloric_acid"},
                       {"resource": "fluid:modern_industrialization:" + product}]
            self.assertEqual(default_output("statech:modern_industrialization/chemical_reactor/" + product, outputs), outputs[1]["resource"])
        self.assertEqual(default_output("pack:water", [{"resource": "energy:eu"}, {"resource": "fluid:pack:water"}]), "energy:eu")
        self.assertEqual(default_output("pack:water", [{"resource": "fluid:first:water"}, {"resource": "fluid:second:water"}]), "fluid:first:water")
        self.assertEqual(default_output("pack:crushed_dust", [{"resource": "item:pack:iron"}, {"resource": "item:pack:crushed_dust"}],
                                        [{"resource": "item:pack:crushed_dust"}]), "item:pack:iron")

    def test_fluid_boilers_use_loaded_fuel_units_and_keep_heavy_water_separate(self):
        capture = {"machine_rules": [{"id": "test:boiler", "mechanic": "mi_boiler", "eu_per_burn_tick": 20,
                    "item_fuel_multiplier": 2, "steam_to_water": 16, "max_eu_per_tick": 8}],
                   "resources": [{"id": "fluid:modern_industrialization:heavy_water"},
                                 {"id": "fluid:modern_industrialization:heavy_water_steam"}],
                   "data_maps": {"modern_industrialization:fluid_fuels": {"test:diesel": {"eu_per_mb": 400}, "test:oversized": {"eu_per_mb": 1600}}}}
        recipes = utility_recipes(capture)
        self.assertEqual(len(recipes), 2)
        self.assertEqual(recipes[0]["inputs"][0], {"choices": ["fluid:test:diesel"], "amount": 1 / 400, "returns": {}})
        self.assertEqual(recipes[0]["configurations"][0]["startup_profile"]["fuel"], {"kind": "fluid", "eu_per_unit": 400})
        self.assertEqual(recipes[1]["inputs"][1]["resource"], "fluid:modern_industrialization:heavy_water")
        self.assertEqual(recipes[1]["primary"], "fluid:modern_industrialization:heavy_water_steam")
        self.assertNotEqual(recipes[0]["id"], recipes[1]["configurations"][0]["id"])

    def test_boiler_envelope_keeps_idle_loss_and_whole_tick_rounding(self):
        samples = [{"steam_per_tick": x, "fuel_eu_per_tick": y} for x, y in [(0, 205), (1, 205), (2, 206), (3, 206), (6, 206)]]
        self.assertEqual(boiler_operating_points(samples), [(0, 205), (1, 205), (6, 206)])
        capture = {"machine_rules": [{"id": "test:boiler", "mechanic": "mi_boiler", "eu_per_burn_tick": 20,
                    "item_fuel_multiplier": 2, "steam_to_water": 16, "max_eu_per_tick": 48,
                    "continuous": True, "eu_per_steam_mb": 8, "hot_running_probe": samples}],
                   "resources": [{"id": "item:test:fuel", "item_rules": {"burn_ticks": 100}}]}
        [recipe] = utility_recipes(capture)
        config = recipe["configurations"][0]
        self.assertEqual(config["operations_per_second"], 120)
        self.assertEqual(recipe["primary"], "fluid:modern_industrialization:high_pressure_steam")
        self.assertEqual(recipe["inputs"], [{"resource": "fluid:modern_industrialization:high_pressure_water", "amount": 1 / 16}])
        self.assertEqual(config["operating_points"][0]["inputs"][0]["amount"], 205 * 20 / 4000)
        self.assertNotIn("hot_running_probe", config["startup_profile"]["rule"])

    def test_tool_replacement_requires_verified_lifetime_and_ae2_reuse(self):
        entry = {"source_id": "modern_industrialization:iron_plate_from_hammer", "raw": {"kubejs:ingredient_actions": [
            {"action": {"damage": 50, "type": "damage"}, "filter": {"item": {"tag": "modern_industrialization:forge_hammer_tools"}}}]}}
        record = {"id": "plates", "name": "Iron plate", "inputs": [{"resource": "item:test:hammer", "amount": 1}], "catalysts": []}
        lifetime = {"item": "test:hammer", "crafts": 34, "ae2_substitutions_verified": True}
        capture = {"crafting_rules": {"recipes": [{"id": entry["source_id"], "tool_lifetimes": [lifetime]}]}}
        result = tool_recipe_variants(entry, record, capture)[0]
        self.assertEqual(result["inputs"][0]["amount"], 1 / 34)
        self.assertEqual(result["catalysts"][0]["amount"], 1)
        self.assertEqual(record["inputs"][0]["amount"], 1)
        lifetime["ae2_substitutions_verified"] = False
        self.assertEqual(tool_recipe_variants(entry, record, capture), [])

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
