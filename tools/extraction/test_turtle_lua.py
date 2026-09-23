import copy
import unittest

from verify_turtle_lua import validate_measurement


class AutonomousTurtleEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.capture = {
            "harvest_ticks": [633, 1262],
            "output_chest_count": 7,
            "input_chest_remaining": 0,
            "computer_on": True,
            "turtle_fuel_remaining": 0,
            "picker_ink": 80,
            "machine_ink": 80,
            "picker_dyes": 0,
            "machine_nuggets": 64,
            "liquid_crystal_remaining_mb": 1000,
        }

    def test_autonomous_two_cycle_sample(self):
        self.assertEqual(validate_measurement(self.capture), [633, 1262])

    def test_timing_cannot_hide_a_missing_growth_cycle(self):
        broken = copy.deepcopy(self.capture)
        broken["harvest_ticks"] = [633, 700]
        with self.assertRaisesRegex(ValueError, "growth cycles"):
            validate_measurement(broken)

    def test_chest_stock_is_not_assumed_to_be_output(self):
        broken = copy.deepcopy(self.capture)
        broken["output_chest_count"] = 4
        with self.assertRaisesRegex(ValueError, "both crops"):
            validate_measurement(broken)

    def test_ink_must_include_two_full_growth_costs(self):
        broken = copy.deepcopy(self.capture)
        broken["machine_ink"] = 320
        with self.assertRaisesRegex(ValueError, "ink network"):
            validate_measurement(broken)
