"""Check storage capture validation without requiring a private game instance."""

import copy
import json
from pathlib import Path
import unittest

from verify_storage import TIERS, verify_storage


class StorageCaptureTest(unittest.TestCase):
    def capture(self):
        machines = []
        for tier, nominal in TIERS.items():
            limit = nominal * 8
            machines.append({"id": f"modern_industrialization:{tier}_storage_unit", "storage_probe": {
                "capacity_eu": nominal * 100000, "nominal_tier_eu": nominal,
                "cable_limit_eu_per_tick": limit, "charge_eu_over_20_ticks": limit * 20,
                "discharge_eu_over_20_ticks": limit * 20}})
        return {"loaded_mods": [{"id": "modern_industrialization", "version": "2.5.8"}],
                "machines": machines, "failures": []}

    def test_all_five_tiers_match_loaded_capacity_and_transfer(self):
        self.assertEqual(len(verify_storage(self.capture())), 5)

    def test_changed_charge_and_failed_probe_are_rejected(self):
        capture = self.capture()
        capture["machines"][0]["storage_probe"]["charge_eu_over_20_ticks"] -= 1
        with self.assertRaisesRegex(ValueError, "capacity or transfer"):
            verify_storage(capture)
        failed = copy.deepcopy(self.capture())
        failed["failures"] = [{"id": "test"}]
        with self.assertRaisesRegex(ValueError, "reported failures"):
            verify_storage(failed)

    def test_tracked_report_retains_the_loaded_tiers_and_private_input_hashes(self):
        path = Path(__file__).resolve().parents[2] / "data/provenance/storage-unit-report.json"
        report = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(report["storage_units"], verify_storage(self.capture()))
        for key in ("capture_sha256", "mod_jar_sha256", "private_world_archive_sha256"):
            self.assertRegex(report[key], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
