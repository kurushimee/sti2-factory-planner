import unittest

from merge_storage_rules import merge_storage_rules


class StorageMergeTests(unittest.TestCase):
    def test_only_the_reported_machine_rule_changes(self):
        probe = {"capacity_eu": 3200000, "nominal_tier_eu": 32,
                 "cable_limit_eu_per_tick": 256, "charge_eu_over_20_ticks": 5120,
                 "discharge_eu_over_20_ticks": 5120}
        base = {"identity": "statech-industry-2:2.0.1", "recipes": [{"id": "kept"}],
                "machine_rules": [{"id": "storage", "source_class": "mi.StorageMachineBlockEntity",
                                   "status": "unsupported"},
                                  {"id": "other", "source_class": "mi.Other", "status": "supported"}]}
        capture = {"machines": [{"id": "storage", "class": "mi.StorageMachineBlockEntity",
                                 "storage_probe": probe}]}
        report = {"capture_sha256": "abc", "storage_units": [{"machine": "storage", "capacity_eu": 3200000,
                                     "charge_eu_per_tick": 256, "discharge_eu_per_tick": 256}]}
        result = merge_storage_rules(base, capture, report)
        self.assertEqual(result["recipes"], base["recipes"])
        self.assertEqual(result["machine_rules"][1], base["machine_rules"][1])
        self.assertEqual(result["machine_rules"][0]["mechanic"], "energy_storage")
        self.assertEqual(result["storage_capture_sha256"], "abc")
        self.assertEqual(base["machine_rules"][0]["status"], "unsupported")
        with self.assertRaisesRegex(ValueError, "disagrees"):
            merge_storage_rules(base, capture, {"storage_units": [{**report["storage_units"][0],
                                                                    "charge_eu_per_tick": 100}]})
