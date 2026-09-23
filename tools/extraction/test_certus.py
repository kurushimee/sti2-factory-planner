"""Keep certus capture verification strict about power, wear, and harvest filters."""

from copy import deepcopy
import json
from pathlib import Path
import unittest
from verify_certus import verify_certus, verify_farms


class CertusEvidenceTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[2] / "data/provenance/certus-growth-report.json"
        report = json.loads(path.read_text(encoding="utf-8"))
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
