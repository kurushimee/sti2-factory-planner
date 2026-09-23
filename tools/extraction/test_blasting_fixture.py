import unittest

from prepare_blasting_fixture import distinct_blasting
from blasting import blasting_catalog


class BlastingFixtureTests(unittest.TestCase):
    def test_distinct_routes_keep_inputs_and_include_a_container_trial(self):
        entries = []
        for index in range(16):
            name = "spectrum:blasting/pure_resources/iron" if index == 0 else f"test:blast_{index}"
            entries.append({"id": name, "recipe": {"type": "minecraft:blasting",
                            "ingredient": {"item": f"test:pure_{index}"},
                            "result": {"id": f"test:output_{index}"}, "cookingtime": 100}})
        result = distinct_blasting({"recipes": entries})
        self.assertEqual(len(result), 17)
        self.assertEqual(result[0]["input"], "test:pure_0")
        self.assertEqual(result[-1]["fuel"], "minecraft:lava_bucket")
        self.assertEqual(result[-1]["fuel_remainder"], "minecraft:bucket")
        entries[1]["recipe"]["cookingtime"] = 200
        with self.assertRaisesRegex(ValueError, "new fixture adapter"):
            distinct_blasting({"recipes": entries})

    def test_loaded_fuel_rules_and_remainders_become_complete_routes(self):
        entries = [{"source_id": "spectrum:blasting/pure_resources/iron" if index == 0 else f"test:blast_{index}",
                    "type": "minecraft:blasting", "raw": {"type": "minecraft:blasting",
                    "ingredient": {"item": f"test:pure_{index}"}, "result": {"id": f"test:output_{index}"},
                    "cookingtime": 100}} for index in range(16)]
        selected = distinct_blasting({"recipes": [{"id": entry["source_id"], "recipe": entry["raw"]} for entry in entries]})
        report = {"trials": [{"recipe": trial["recipe"], "input": trial["input"], "fuel": trial["fuel"],
                              "output": trial["output"], "output_count": 1, "completion_tick": 100,
                              "fuel_slot": trial.get("fuel_remainder", "minecraft:air"),
                              "itemstack_burn_ticks": 20000 if trial["fuel"] == "minecraft:lava_bucket" else 1600,
                              "burn_time_remaining_ticks": 9901 if trial["fuel"] == "minecraft:lava_bucket" else 701}
                             for trial in selected]}
        machine, recipes, sources = blasting_catalog({"recipes": entries}, report, {})
        self.assertEqual(len(recipes), 32)
        self.assertEqual(len(sources), 16)
        self.assertEqual(machine["fuel_burn_ticks"], {"minecraft:coal": 800, "minecraft:lava_bucket": 10000})
        coal = next(value for value in recipes if value["source_id"].endswith("/iron") and
                    value["inputs"][1]["resource"] == "item:minecraft:coal")
        lava = next(value for value in recipes if value["source_id"].endswith("/iron") and
                    value["inputs"][1]["resource"] == "item:minecraft:lava_bucket")
        self.assertEqual(coal["inputs"][1]["amount"], 0.125)
        self.assertEqual(lava["inputs"][1]["amount"], 0.01)
        self.assertEqual(lava["inputs"][1]["returns"]["item:minecraft:lava_bucket"][0]["resource"],
                         "item:minecraft:bucket")
        report["trials"][0]["burn_time_remaining_ticks"] -= 1
        with self.assertRaisesRegex(ValueError, "fuel duration changed"):
            blasting_catalog({"recipes": entries}, report, {})
