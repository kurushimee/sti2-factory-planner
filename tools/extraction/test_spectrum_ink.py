import unittest

from spectrum_ink import color_picker_catalog


COLORS = ("black", "blue", "brown", "cyan", "gray", "green", "light_blue",
          "light_gray", "lime", "magenta", "orange", "pink", "purple", "red",
          "white", "yellow")
AMOUNTS = {"dye": 5, "pigment": 100, "pigment_blocks": 900}


def loaded_ink_recipes():
    return {"recipes": [
        {"id": f"spectrum:ink_converting/{kind}/{color}",
         "recipe": {"type": "spectrum:ink_converting",
                    "ingredient": {"item": f"test:{kind}_{color}"},
                    "ink_color": f"spectrum:{color}", "amount": amount}}
        for kind, amount in AMOUNTS.items() for color in COLORS
    ]}


MEASUREMENT = {"color_picker": [
    {"brown_ink": 5, "dye_remaining": 2},
    {"brown_ink": 10, "dye_remaining": 1},
    {"brown_ink": 15, "dye_remaining": 0},
]}


class SpectrumInkTest(unittest.TestCase):
    def test_loaded_recipe_families_keep_their_distinct_material_costs(self):
        resources, machine, recipes, sources = color_picker_catalog(loaded_ink_recipes(), MEASUREMENT)
        self.assertEqual((len(resources), len(recipes), len(sources)), (16, 48, 48))
        self.assertEqual(machine["operation_ticks"], 5)
        brown = [recipe for recipe in recipes if recipe["primary"] == "ink:spectrum:brown"]
        self.assertEqual({recipe["outputs"][0]["amount"] for recipe in brown}, {5, 100, 900})
        self.assertEqual({recipe["inputs"][0]["resource"] for recipe in brown},
                         {"item:test:dye_brown", "item:test:pigment_brown",
                          "item:test:pigment_blocks_brown"})
        self.assertTrue(all(recipe["configurations"][0]["operations_per_second"] == 4 for recipe in brown))

    def test_changed_loaded_amount_is_rejected(self):
        runtime = loaded_ink_recipes()
        runtime["recipes"][0]["recipe"]["amount"] = 6
        with self.assertRaisesRegex(ValueError, "changed"):
            color_picker_catalog(runtime, MEASUREMENT)

    def test_unmeasured_conversion_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "trial"):
            color_picker_catalog(loaded_ink_recipes(), {"color_picker": []})


if __name__ == "__main__":
    unittest.main()
