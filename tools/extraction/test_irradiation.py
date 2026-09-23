import unittest

from irradiation import irradiation_recipes


class IrradiationTests(unittest.TestCase):
    def test_loaded_source_costs_remain_installed_costs_at_partial_load(self):
        capture = {"machine_rules": [{"id": "test:irradiator", "mechanic": "irradiator", "nuclear_hatch_limit": 8}],
                   "resources": [{"id": "item:test:rod", "item_rules": {"nuclear_fuel": {
                       "disintegrations": 10240000, "product": "test:depleted", "product_amount": 1}}},
                                 {"id": "item:test:source", "item_rules": {"max_damage": 320}}],
                   "data_maps": {"yet_another_industrialization:irradiator_neutron_source": {
                       "test:source": {"irradiation": 16384, "eu": 8192, "type": "lifespan",
                                       "probability": 1, "probability_check_cooldown": 50}}}}
        [recipe] = irradiation_recipes(capture)
        self.assertEqual(len(recipe["configurations"]), 8)
        one, eight = recipe["configurations"][0], recipe["configurations"][-1]
        self.assertEqual(one["capacity"]["ticks_per_batch"], 625)
        self.assertEqual(eight["operations_per_second"], 8 * 20 / 625)
        self.assertEqual(one["idle_eu_per_tick"], 8192 * 15999 / 16000)
        self.assertEqual(eight["operating_points"][0]["inputs"], [{"resource": "item:test:source", "amount": 1 / 800}])
        self.assertEqual(one["operating_points"][0]["inputs"], one["operating_points"][1]["inputs"])
        self.assertEqual(recipe["inputs"], [{"resource": "item:test:rod", "amount": 1}])
        self.assertEqual(eight["startup_profile"]["batch"], 8)
        self.assertEqual(eight["startup_profile"]["discovery_delay_ticks"], 59)
        source = capture["data_maps"]["yet_another_industrialization:irradiator_neutron_source"]["test:source"]
        source.update(type="consumption", probability=0.05, probability_check_cooldown=200, irradiation=1280, eu=1024)
        configuration = irradiation_recipes(capture)[0]["configurations"][0]
        self.assertEqual(configuration["idle_eu_per_tick"], 1024)
        self.assertEqual(configuration["operating_points"][0]["inputs"][0]["amount"], 0.005)
        capture["data_maps"]["yet_another_industrialization:irradiator_neutron_source"]["test:source"]["restricted_to"] = {"tag": "test:rods"}
        with self.assertRaisesRegex(ValueError, "resolved fuel predicate"):
            irradiation_recipes(capture)
