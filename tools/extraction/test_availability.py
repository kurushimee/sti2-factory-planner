import unittest

from availability import annotate_availability, REMOVED_MACHINES


class AvailabilityTests(unittest.TestCase):
    def test_removed_machines_remain_inspectable_without_automatic_availability(self):
        machines = [{"id": identity, "status": "supported"} for identity in [*REMOVED_MACHINES, "test:ordinary"]]
        recipes = [{"replication": True, "outputs": [{"resource": "item:" + identity}]} for identity in REMOVED_MACHINES]
        result = annotate_availability(machines, recipes)
        self.assertEqual(len(result), len(machines))
        self.assertTrue(all(not machine["availability"]["automatic"] for machine in result[:-1]))
        self.assertNotIn("availability", result[-1])
        self.assertTrue(all("availability" not in machine for machine in machines))

    def test_new_production_recipe_requires_rechecking_the_pack_evidence(self):
        identity = next(iter(REMOVED_MACHINES))
        with self.assertRaisesRegex(ValueError, "evidence needs review"):
            annotate_availability([{"id": identity}], [{"outputs": [{"resource": "item:" + identity}]}])
