"""Check solar cell wear and the daily output guarantee against source rules."""

import json
from pathlib import Path
import unittest

from add_solar_routes import add_solar_routes
from refresh_solar_routes import refresh_solar_routes
from verify_solar import TIERS


REPORT = json.loads((Path(__file__).resolve().parents[2] /
                     "data/provenance/solar-panel-report.json").read_text(encoding="utf-8"))


def base():
    machine_ids = [f"extended_industrialization:{tier}_solar_panel" for tier in TIERS]
    resources = ["energy:eu", "fluid:extended_industrialization:distilled_water"]
    for tier in TIERS:
        resources.extend([f"item:extended_industrialization:{tier}_solar_panel",
                          f"item:extended_industrialization:{tier}_photovoltaic_cell"])
    return {"identity": "statech-industry-2:2.0.1", "resources": [{"id": value} for value in resources],
            "machines": [{"id": value, "status": "unsupported"} for value in machine_ids],
            "recipes": [], "progression": [{"id": "statech:all", "available_machines": []}],
            "source": {}, "default_machines": []}


class SolarRoutesTest(unittest.TestCase):
    def test_six_routes_keep_exact_cell_use_and_clear_day_minimum(self):
        catalog = add_solar_routes(base(), REPORT, "report-hash")
        self.assertEqual(len(catalog["recipes"]), 6)
        self.assertEqual(len({entry["source_id"] for entry in catalog["recipes"]}), 6)
        self.assertEqual(len(catalog["progression"][0]["available_machines"]), 3)
        self.assertEqual(catalog["default_machines"], [])
        for recipe in catalog["recipes"]:
            configuration = recipe["configurations"][0]
            profile = configuration["periodic_generation"]
            self.assertEqual(sum(row["ticks"] for row in profile["segments"]), 24000)
            total = sum(row["ticks"] * row["eu_per_tick"] for row in profile["segments"])
            self.assertAlmostEqual(recipe["outputs"][0]["amount"] * 1200,
                                   total - profile["one_event_loss_eu_per_period"])
            cycle = profile["cell_cycle"]
            self.assertEqual(cycle["active_ticks_per_clear_day"], 11999)
            self.assertEqual(cycle["energy_eu_without_expiry_per_day"], total)
            self.assertEqual(recipe["inputs"][0]["amount"],
                             cycle["cells_used_per_repeating_cycle"] /
                             (cycle["repeating_clear_days"] * 1200))
            self.assertEqual(cycle["minimum_energy_eu_in_one_clear_day"],
                             total - profile["one_event_loss_eu_per_period"])
            self.assertEqual(configuration["build_requirements"][0]["resource"],
                             "item:" + configuration["machine"])
            if recipe["name"].endswith("(water)"):
                self.assertEqual(recipe["inputs"][1]["amount"], 11999 / 1200)

    def test_changed_evidence_and_duplicate_application_fail(self):
        original = base()
        self.assertRaisesRegex(ValueError, "already has solar", add_solar_routes,
                               add_solar_routes(original, REPORT, "hash"), REPORT, "hash")
        bad = {**REPORT, "mod_jar_sha256": "different"}
        self.assertRaisesRegex(ValueError, "released", add_solar_routes, original, bad, "hash")
        changed = {**REPORT, "panels": [{**REPORT["panels"][0], "dry_clear_day": {
            **REPORT["panels"][0]["dry_clear_day"], "nominal_eu_per_day": 1}},
            *REPORT["panels"][1:]]}
        self.assertRaisesRegex(ValueError, "curve disagrees", add_solar_routes,
                               original, changed, "hash")

    def test_refresh_keeps_other_catalog_records(self):
        original = add_solar_routes(base(), REPORT, "hash")
        original["recipes"].append({"id": "other", "outputs": []})
        refreshed = refresh_solar_routes(original, REPORT, "hash")
        self.assertEqual(refreshed, original)
        wrong = {**original, "source": {"solar_report_sha256": "different"}}
        self.assertRaisesRegex(ValueError, "pinned", refresh_solar_routes,
                               wrong, REPORT, "hash")


if __name__ == "__main__":
    unittest.main()
