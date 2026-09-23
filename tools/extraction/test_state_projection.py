import unittest
from verify_state_projection import verify


class StateProjectionTests(unittest.TestCase):
    def setUp(self):
        self.old = {"source_class": "state-predicate", "state_only_verified": True, "matching_states": [
            {"Name": "test:stairs", "Properties": {"facing": "north", "waterlogged": "true"}},
            {"Name": "test:stairs", "Properties": {"facing": "south", "waterlogged": "true"}}]}
        self.rule = {**self.old, "matching_states": [{"Name": "test:stairs", "Properties": {"waterlogged": "true"}}],
                     "projection_verified": True, "matching_state_count": 2, "projection_checked_state_count": 4}

    def test_irrelevant_direction_is_removed_without_losing_accepted_states(self):
        report = verify({"failures": [], "shape_member_rules": [self.rule]}, [self.old])
        self.assertEqual(report["rules"][0]["old_patterns"], 2)
        self.assertEqual(report["rules"][0]["patterns"], 1)

    def test_missing_runtime_proof_or_lost_state_is_rejected(self):
        for update in ({"projection_verified": False}, {"matching_states": []}):
            with self.assertRaises(ValueError):
                verify({"failures": [], "shape_member_rules": [{**self.rule, **update}]}, [self.old])
