"""Check solar profile arithmetic separately from the captured machine samples."""

import copy
import unittest

from verify_solar import clear_day, clear_efficiency, verify_samples


class SolarProfileTest(unittest.TestCase):
    def test_clear_day_curve_and_integer_output(self):
        self.assertEqual(clear_efficiency(0), 0)
        self.assertEqual(clear_efficiency(1500), 1)
        self.assertEqual(clear_efficiency(6000), 1)
        self.assertEqual(clear_efficiency(10500), 1)
        self.assertEqual(clear_efficiency(12000), 0)
        self.assertEqual(clear_efficiency(12001), 0)
        self.assertEqual(clear_day(32)["nominal_eu_per_day"], 336782)
        self.assertEqual(clear_day(32, True)["nominal_eu_per_day"], 505934)
        self.assertEqual(clear_day(32, True)["distilled_water_mb_per_clear_day"], 11999)
        self.assertGreater(clear_day(32)["ideal_storage_eu_for_flat_average"], 170000)

    def test_condition_or_cell_change_rejects_a_sample(self):
        samples = []
        items = []
        for tier, peak in (("lv", 32), ("mv", 128), ("hv", 512)):
            samples.append({"machine": f"extended_industrialization:{tier}_solar_panel",
                            "cell": f"extended_industrialization:{tier}_photovoltaic_cell",
                            "can_see_sky": True,
                            "clear_samples": [{"time": time, "generated_eu": output, "cell_ticks": wear}
                                              for time, output, wear in ((0, 0, 0), (1500, peak, 1),
                                                                         (6000, peak, 2), (10500, peak, 3),
                                                                         (12000, 0, 3), (12001, 0, 3))],
                            "distilled_water_generated_eu": peak * 3 // 2,
                            "distilled_water_remaining_mb": 9, "distilled_water_cell_ticks": 4,
                            "rain_generated_eu": 0, "blocked_stone_present": True,
                            "blocked_can_see_sky": False, "blocked_generated_eu": 0})
            items.append({"id": f"extended_industrialization:{tier}_photovoltaic_cell",
                          "photovoltaic_cell": {"tier": tier, "eu_per_tick": peak,
                                                "lifetime_ticks": 12000, "minimum_efficiency": 0.0}})
        capture = {"item_rules": {"items": items}}
        self.assertEqual(len(verify_samples(samples, capture)), 3)
        wrong = copy.deepcopy(samples)
        wrong[0]["rain_generated_eu"] = 1
        with self.assertRaisesRegex(ValueError, "sample changed"):
            verify_samples(wrong, capture)


if __name__ == "__main__":
    unittest.main()
