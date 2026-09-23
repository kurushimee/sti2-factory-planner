import unittest

from machine_rules import machine_rules


class MachineRuleTests(unittest.TestCase):
    def test_storage_rule_preserves_loaded_capacity_and_transfer(self):
        probe = {"capacity_eu": 3200000, "nominal_tier_eu": 32,
                 "cable_limit_eu_per_tick": 256, "charge_eu_over_20_ticks": 5120,
                 "discharge_eu_over_20_ticks": 5120}
        [rule] = machine_rules([{"id": "mi:lv_storage_unit", "class": "mi.StorageMachineBlockEntity",
                                 "storage_probe": probe}], {})
        self.assertEqual(rule["mechanic"], "energy_storage")
        self.assertEqual(rule["storage"]["capacity_eu"], 3200000)
        self.assertEqual(rule["storage"]["discharge_eu_per_tick"], 256)
        self.assertEqual(rule["status"], "infrastructure")
        with self.assertRaisesRegex(ValueError, "transfer samples"):
            machine_rules([{"id": "mi:bad", "class": "mi.StorageMachineBlockEntity",
                            "storage_probe": {**probe, "discharge_eu_over_20_ticks": 0}}], {})

    def test_tesla_infrastructure_preserves_loaded_limits_without_becoming_a_recipe(self):
        [rule] = machine_rules([{"id": "test:tesla", "class": "ei.TeslaTowerBlockEntity",
            "tesla_tower_probe": {"tiers": [{"shape": 0, "passive_eu_per_tick": 64,
                "max_transfer_eu_per_tick": 1536, "max_axis_distance": 32}]}}], {})
        self.assertEqual(rule["status"], "infrastructure")
        self.assertEqual(rule["infrastructure"][0]["passive_eu_per_tick"], 64)
        self.assertEqual(rule["infrastructure"][0]["max_transfer_eu_per_tick"], 1536)
        self.assertIsNone(rule["recipe_type"])

    def test_recipe_generators_keep_their_own_structure_requirements(self):
        siphon, pulse = machine_rules([
            {"id": "yet_another_industrialization:dragon_egg_energy_siphon", "class": "yai.Siphon",
             "recipe_generation_probe": [{"eu_delivered_on_completion": 102400}]},
            {"id": "yet_another_industrialization:pulse_detonation_generator", "class": "yai.Pulse",
             "recipe_generation_probe": [{"eu_delivered_on_completion": 544000}]}], {})
        self.assertEqual(siphon["build_inputs"], [{"resource": "item:minecraft:dragon_egg", "amount": 1}])
        self.assertNotIn("build_inputs", pulse)
        self.assertEqual(pulse["mechanic"], "fixed_cycle")

    def test_steam_multiblocks_keep_hatch_tiers_and_do_not_gain_electric_upgrades(self):
        [rule] = machine_rules([{"id": "test:quarry", "class": "mi.SteamCraftingMultiblockBlockEntity",
                                 "base_eu": 2, "max_eu": 2, "recipe_type": "mi:quarry"}], {"mi:upgrade": {}})
        self.assertEqual(rule["energy_resource"], "fluid:modern_industrialization:steam")
        self.assertEqual(rule["upgrades"], [])
        self.assertEqual(rule["steel_hatch_variant"]["max_eu"], 4)

    def test_batch_transform_uses_the_loaded_probe_and_unknown_subclasses_stay_visible(self):
        rules = machine_rules([
            {"id": "test:batch", "class": "tesseract.ElectricMultipliedCraftingMultiblockBlockEntity",
             "base_eu": 8, "max_eu": 32, "batch_limit": 16, "batch_energy_probe_input": 1000000,
             "batch_energy_probe_output": 13600000},
            {"id": "test:unknown", "class": "addon.SpecialElectricCrafter"}], {})
        self.assertEqual(rules[0]["energy_multiplier"], 0.85)
        self.assertEqual(rules[1]["status"], "unsupported")
