"""Check the conservative solar adapter against the recorded loaded-world facts."""

import json
from pathlib import Path
import unittest

from add_solar_routes import add_solar_routes
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
    def test_six_routes_preserve_clear_day_output_and_conservative_inputs(self):
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
            self.assertEqual(recipe["inputs"][0]["amount"], 1 / 1200)
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


if __name__ == "__main__":
    unittest.main()
