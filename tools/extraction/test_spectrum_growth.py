import copy
import unittest

from verify_spectrum_growth import validate_measurement


class SpectrumGrowthEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.capture = {
            "always_on_removed_small_bud_after_ticks": 2,
            "grid_idle_ae_per_tick": 2.09375,
            "ink_transfer": [
                {"cycle": 0, "tick": 1, "picker_ink": 3, "machine_ink": 2},
                {"cycle": 0, "tick": 100, "picker_ink": 34, "machine_ink": 26},
                {"cycle": 1, "tick": 1, "picker_ink": 40, "machine_ink": 40},
                {"cycle": 1, "tick": 100, "picker_ink": 71, "machine_ink": 64},
            ],
            "cycles": [
                {"cycle": 0, "mature_tick": 600, "growth_ticks": 720, "harvested": 4,
                 "plane_active": True, "top_cleared": True, "dyes_remaining": 0,
                 "network_energy_ae": 263.84375, "additive_remaining": 56,
                 "picker_ink": 40, "machine_ink": 40},
                {"cycle": 1, "mature_tick": 600, "growth_ticks": 600, "harvested": 3,
                 "plane_active": True, "top_cleared": True, "dyes_remaining": 0,
                 "network_energy_ae": 10.59375, "additive_remaining": 54,
                 "picker_ink": 84, "machine_ink": 76},
            ],
            "fluid_remaining_mb": 1000,
            "pickup_control": "The grid ticks only after the crop reaches its mature cluster state.",
        }

    def test_staged_evidence_retains_ink_and_startup_fluid(self):
        self.assertEqual(len(validate_measurement(self.capture)), 2)

    def test_always_on_plane_cannot_be_recorded_as_a_working_farm(self):
        missing = copy.deepcopy(self.capture)
        missing["always_on_removed_small_bud_after_ticks"] = None
        with self.assertRaisesRegex(ValueError, "always-on plane"):
            validate_measurement(missing)

    def test_unbalanced_ink_cannot_be_hidden_by_the_output_sample(self):
        unbalanced = copy.deepcopy(self.capture)
        unbalanced["cycles"][1]["machine_ink"] += 5
        with self.assertRaisesRegex(ValueError, "ink network"):
            validate_measurement(unbalanced)

    def test_staged_pickup_requires_an_explicit_gate_limit(self):
        unsupported = copy.deepcopy(self.capture)
        unsupported["pickup_control"] = ""
        with self.assertRaisesRegex(ValueError, "unbuilt gate"):
            validate_measurement(unsupported)
