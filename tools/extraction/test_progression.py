import unittest

from progression import progression_presets


class ProgressionTests(unittest.TestCase):
    def test_removed_machines_are_excluded_even_when_a_quest_mentions_them(self):
        chapters = [{"file": "2__steam_age.snbt", "id": "steam", "item_tasks": [{"item": "test:removed"}]}]
        machines = [{"id": "test:removed", "status": "supported", "availability": {"automatic": False}}]
        self.assertTrue(all(not preset["available_machines"] for preset in progression_presets(chapters, machines, [])))

    def test_hatch_presets_follow_quest_evidence_separately_from_machines(self):
        chapters = [{"file": "2__steam_age.snbt", "id": "steam", "item_tasks": [{"item": "test:bronze_hatch"}]}]
        machines = [{"id": identity, "status": "structural", "hatch_capacity": {"item_slots": [64]}}
                    for identity in ["test:bronze_hatch", "test:steel_hatch"]]
        result = progression_presets(chapters, machines, [])
        self.assertEqual(result[0]["available_parts"], ["test:bronze_hatch"])
        self.assertEqual(result[0]["available_machines"], [])
        self.assertEqual(result[1]["available_parts"], ["test:bronze_hatch", "test:steel_hatch"])

    def test_parts_include_crafting_closure_and_declared_tier_defaults(self):
        chapters = [{"file": "2__steam_age.snbt", "id": "steam", "item_tasks": [{"item": "test:metal"}]}]
        identities = ["test:hatch", "modern_industrialization:bronze_item_input_hatch", "modern_industrialization:mv_energy_input_hatch"]
        machines = [{"id": identity, "status": "structural", "hatch_capacity": {"item_slots": [64]}} for identity in identities]
        recipes = [{"id": name, "primary": output, "process": {"type": "planner:crafting"}, "inputs": [{"resource": source}]}
                   for name, source, output in [("plate", "item:test:metal", "item:test:plate"),
                                                ("hatch", "item:test:plate", "item:test:hatch")]]
        result = progression_presets(chapters, machines, [], recipes)[0]
        self.assertEqual(result["available_parts"], sorted(identities[:2]))
        self.assertEqual(result["source"]["derived_parts"], [{"part": "test:hatch", "recipe": "hatch"}])
        self.assertEqual(result["source"]["hatch_tier_defaults"]["mv"], 4)

    def test_verified_conversions_need_both_the_old_machine_and_upgrade_materials(self):
        chapters = [
            {"file": "2__steam_age.snbt", "id": "steam", "item_tasks": [{"item": "test:bronze"}]},
            {"file": "3__electrical_age.snbt", "id": "electric", "item_tasks": [{"item": "test:upgrade"}]},
        ]
        machines = [{"id": "test:bronze", "status": "supported"}, {"id": "test:steel", "status": "supported"}]
        recipe = {"id": "upgrade", "primary": "item:test:steel", "process": {"type": "planner:crafting"},
                  "inputs": [{"resource": "item:test:bronze"}, {"choices": ["item:test:upgrade", "item:test:other"]}]}
        result = progression_presets(chapters, machines, [], [recipe])
        self.assertEqual(result[0]["available_machines"], ["test:bronze"])
        self.assertEqual(result[1]["available_machines"], ["test:bronze", "test:steel"])
        self.assertEqual(result[1]["source"]["derived_conversions"], [{"machine": "test:steel", "recipe": "upgrade"}])
        recipe["unsupported"] = "Unknown crafting behavior."
        self.assertEqual(progression_presets(chapters, machines, [], [recipe])[1]["available_machines"], ["test:bronze"])

    def test_presets_follow_cumulative_item_tasks_without_granting_supplies(self):
        chapters = [
            {"file": "chapters/2__steam_age.snbt", "id": "steam", "item_tasks": [{"item": "test:press"}]},
            {"file": "chapters/3__electrical_age.snbt", "id": "electric", "item_tasks": [{"item": "test:upgrade"}, {"item": "test:unsupported"}]},
        ]
        result = progression_presets(chapters, [
            {"id": "test:press", "status": "supported"}, {"id": "test:unlisted", "status": "supported"},
            {"id": "test:unsupported", "status": "unsupported"}], [{"id": "test:upgrade"}])
        self.assertEqual(result[0]["available_machines"], ["test:press"])
        self.assertEqual(result[0]["available_upgrades"], [])
        self.assertEqual(result[1]["available_machines"], ["test:press"])
        self.assertEqual(result[1]["available_upgrades"], ["test:upgrade"])
        self.assertEqual(result[2]["available_machines"], ["test:press", "test:unlisted"])
        self.assertTrue(all("external" not in preset and "obtained_resources" not in preset for preset in result))
