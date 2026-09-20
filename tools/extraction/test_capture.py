"""Regression checks for extraction identity and failure handling."""

import unittest
from verify_capture import canonical_runtime, verify


class CaptureTests(unittest.TestCase):
    def test_proxy_recipes_keep_their_type_identity(self):
        recipes = [
            {"id": "example:ore", "recipe": {"type": "minecraft:smelting"}},
            {"id": "example:ore", "recipe": {"type": "modern_industrialization:furnace"}},
        ]
        data = {"recipes": recipes, "resources": [], "tags": {}, "failures": []}
        canonical = canonical_runtime(data)
        self.assertEqual(len(canonical["recipes"]), 2)
        self.assertNotEqual(canonical["recipes"][0]["recipe"]["type"], canonical["recipes"][1]["recipe"]["type"])

    def test_capture_order_does_not_change_identity(self):
        first = {
            "recipes": [{"id": "b", "recipe": {"type": "craft"}}, {"id": "a", "recipe": {"type": "craft"}}],
            "resources": [{"kind": "item", "id": "b"}, {"kind": "item", "id": "a"}],
            "tags": {"item:test": ["b", "a"]}, "failures": [],
        }
        second = {"recipes": list(reversed(first["recipes"])), "resources": list(reversed(first["resources"])), "tags": {"item:test": ["a", "b"]}, "failures": []}
        self.assertEqual(canonical_runtime(first), canonical_runtime(second))

    def test_failed_exports_cannot_pass(self):
        with self.assertRaisesRegex(ValueError, "extraction failures"):
            verify({"failures": [{"id": "lost:recipe"}]}, {"failures": []})

    def test_duplicate_recipe_identity_cannot_pass(self):
        recipe = {"id": "ore", "recipe": {"type": "macerator"}}
        with self.assertRaisesRegex(ValueError, "Duplicate recipe"):
            verify({"failures": [], "recipes": [recipe, recipe]}, {"failures": []})

    def test_unresolved_tag_member_cannot_pass(self):
        data = {"failures": [], "recipes": [], "resources": [], "tags": {"item:ores": ["missing:ore"]}}
        with self.assertRaisesRegex(ValueError, "unknown resource"):
            verify(data, {"failures": []})


if __name__ == "__main__":
    unittest.main()
