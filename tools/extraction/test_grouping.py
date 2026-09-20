import unittest
from grouping import production_group


class GroupingTests(unittest.TestCase):
    def test_visual_categories_preserve_authored_groups(self):
        self.assertEqual(production_group({"primary": "energy:eu"}), "Power")
        self.assertEqual(production_group({"primary": "item:mi:steel_plate"}), "Metals")
        self.assertEqual(production_group({"primary": "item:mi:analog_circuit"}), "Circuits")
        self.assertEqual(production_group({"primary": "fluid:mi:diesel"}), "Fuels")
        self.assertEqual(production_group({"primary": "fluid:mi:acid"}), "Chemicals")
        self.assertEqual(production_group({"primary": "item:mi:ore", "process": {"type": "mi:quarry"}}), "Extraction")
        self.assertEqual(production_group({"primary": "item:mi:dust", "process": {"type": "mi:macerator"}}), "Ore processing")
        self.assertEqual(production_group({"primary": "energy:eu", "group": "My power district"}), "My power district")
