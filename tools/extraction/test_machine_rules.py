import unittest

from machine_rules import machine_rules


class MachineRuleTests(unittest.TestCase):
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
