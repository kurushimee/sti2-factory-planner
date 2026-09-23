import copy
import unittest

from verify_turtle_growth import validate_measurement


class TurtleGrowthEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.capture = {
            "machine_item_handler": True,
            "picker_item_handler": True,
            "turtle_item_handler": True,
            "turtle_stationary_fuel": 0,
            "turtle_fuel_needed": True,
            "cycles": [],
            "fluid_remaining_mb": 1000,
        }
        for index in range(2):
            self.capture["cycles"].append({
                "cycle": index, "mature_tick": 600, "collected": 4,
                "top_cleared": True, "input_chest_remaining": 1 - index,
                "output_chest_total": 4 * (index + 1), "turtle_fuel_remaining": 0,
                "inspected_stages": [
                    {"tick": 1, "name": "spectrum:small_iron_bud"},
                    {"tick": 300, "name": "spectrum:large_iron_bud"},
                    {"tick": 600, "name": "spectrum:iron_cluster"},
                ],
                "picker_ink": 44 if index == 0 else 84,
                "machine_ink": 36 if index == 0 else 76,
                "additive_refill": 64 if index == 0 else 2,
                "additive_remaining": 62 if index == 0 else 59,
                "picker_dye_refill": 64 * index,
            })

    def test_placed_inventory_and_ink_balance(self):
        self.assertEqual(len(validate_measurement(self.capture)), 2)

    def test_output_chest_must_receive_both_harvests(self):
        broken = copy.deepcopy(self.capture)
        broken["cycles"][1]["output_chest_total"] = 4
        with self.assertRaisesRegex(ValueError, "output chest"):
            validate_measurement(broken)

    def test_immature_bud_must_be_recognized(self):
        broken = copy.deepcopy(self.capture)
        broken["cycles"][0]["inspected_stages"][0]["name"] = "spectrum:iron_cluster"
        with self.assertRaisesRegex(ValueError, "inspection"):
            validate_measurement(broken)

    def test_side_fed_dye_must_be_recorded(self):
        broken = copy.deepcopy(self.capture)
        broken["cycles"][1]["picker_dye_refill"] = 0
        with self.assertRaisesRegex(ValueError, "dye stock"):
            validate_measurement(broken)

    def test_startup_fluid_is_not_consumed_per_cycle(self):
        broken = copy.deepcopy(self.capture)
        broken["fluid_remaining_mb"] = 0
        with self.assertRaisesRegex(ValueError, "startup fill"):
            validate_measurement(broken)
