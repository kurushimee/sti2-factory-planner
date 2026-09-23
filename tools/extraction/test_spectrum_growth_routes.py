import unittest

from spectrum_growth import operating_rule


class SpectrumGrowthOperatingRuleTest(unittest.TestCase):
    def test_loaded_iron_nugget_rule_matches_the_autonomous_trial(self):
        self.assertEqual(operating_rule(60, 3, 2, 4, 0.5, 0.2), {
            "growth_ticks": 600,
            "cycle_ticks": 640,
            "ink_per_operation": 240,
            "additive_per_operation": 6,
        })

    def test_loaded_diamond_coal_rule_uses_steps_per_stage(self):
        self.assertEqual(operating_rule(480, 3, 3, 8, 0.25, 0.2), {
            "growth_ticks": 2400,
            "cycle_ticks": 2440,
            "ink_per_operation": 2160,
            "additive_per_operation": 24,
        })

    def test_small_fractional_acceleration_uses_the_loaded_integer_progress(self):
        self.assertEqual(operating_rule(300, 3, 4, 0.75, 0.75, 0.05), {
            "growth_ticks": 16000,
            "cycle_ticks": 16040,
            "ink_per_operation": 7200,
            "additive_per_operation": 40,
        })
