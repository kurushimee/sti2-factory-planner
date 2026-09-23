"""Keep certus capture verification strict about power, wear, and harvest filters."""

from copy import deepcopy
import json
from pathlib import Path
import unittest
from verify_certus import verify_certus, verify_farms
from add_exact_certus_capacity import add_exact_capacity


class CertusEvidenceTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[2] / "data/provenance/certus-growth-report.json"
        report = json.loads(path.read_text(encoding="utf-8"))
        self.report = report
        self.capture = report["certus_growth"]
        self.farms = report["certus_farms"]

    def test_recorded_loaded_branches(self):
        verify_certus(self.capture)
        verify_farms(self.farms)

    def test_missing_harvests_and_double_charged_accelerators_are_rejected(self):
        for field, value in [("output_items", 0), ("energy_ae", self.farms[0]["energy_ae"] + 80)]:
            changed = deepcopy(self.farms)
            changed[0][field] = value
            with self.assertRaises(ValueError):
                verify_farms(changed)

    def test_power_wear_and_filter_changes_are_rejected(self):
        for field, mutate in [
            ("accelerator_local_ae_per_call", lambda value: 0),
            ("storage_insertion", lambda value: []),
            ("forced_success_and_decay_transitions", lambda value: value[:-1]),
            ("filtered_plane_harvesting", lambda value: value[:-1]),
        ]:
            with self.subTest(field=field):
                changed = deepcopy(self.capture)
                changed[field] = mutate(changed[field])
                with self.assertRaises(ValueError):
                    verify_certus(changed)

    def test_expected_rate_keeps_the_exact_source_probability(self):
        routes = [{"id": name, "type": "planner:certus_growth", "expected_yields": True,
                   "configurations": [{"operations_per_second": 1 / 12, "idle_eu_per_tick": 3.109375,
                                       "eu_per_operation": 2.1 if name.endswith("crystals") else 5.800000000000001,
                                       "capacity": {}}]}
                  for name in ("certus_growth|crystals", "certus_growth|clusters")]
        catalog = {"identity": "statech-industry-2:2.0.1", "loaded_mods": [{"id": "ae2", "version": "19.2.17"}],
                   "recipes": routes, "source": {}}
        output = add_exact_capacity(catalog, self.report, "verified-hash")
        self.assertTrue(all(route["configurations"][0]["capacity"]["expected_operations_per_second_ratio"] ==
                            {"numerator": "1", "denominator": "12"} for route in output["recipes"]))
        self.assertEqual(output["recipes"][1]["configurations"][0]["eu_per_operation"], 5.8)
        self.assertEqual(output["recipes"][1]["configurations"][0]["capacity"]
                         ["average_full_load_eu_per_tick_ratio"], {"numerator": "15041", "denominator": "4800"})
        self.assertEqual(output["source"]["certus_report_sha256"], "verified-hash")
