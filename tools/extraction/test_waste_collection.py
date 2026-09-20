import unittest

from machine_rules import machine_rules
from player_dataset import utility_recipes


class WasteCollectionTests(unittest.TestCase):
    def test_measured_cycles_keep_animals_as_startup_stock(self):
        for electric in (False, True):
            energy_resource = "energy:eu" if electric else "fluid:modern_industrialization:steam"
            rule = machine_rules([{"id": "test:collector", "class": "test.Collector", "waste_collector_probe": {
                "test_ticks": 600, "samples": [{"animals": 1, "energy_consumed": 2400,
                    "energy_resource": energy_resource, "deliveries": [{"tick": 300, "amount_mb": 2000}]}]}}], {})[0]
            self.assertEqual(rule["operation_ticks"], 300)
            self.assertEqual(rule["energy_per_tick"], 4)
            [recipe] = utility_recipes({"machine_rules": [rule], "resources": [], "data_maps": {}})
            [configuration] = recipe["configurations"]
            self.assertEqual(configuration["operations_per_second"], 1 / 15)
            self.assertEqual(configuration["startup_inputs"], [{"resource": "site:live_farm_animal", "amount": 1}])
            self.assertEqual(configuration["eu_per_operation"], 1200 if electric else 0)
            self.assertEqual(recipe["inputs"], [] if electric else [{"resource": energy_resource, "amount": 1200}])
            self.assertEqual(recipe["outputs"][0]["amount"], 2000)
