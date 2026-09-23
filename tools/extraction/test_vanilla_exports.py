"""Check that vanilla-to-MI export audits reject changed material rules."""

import copy
import json
from pathlib import Path
import unittest

from verify_vanilla_exports import verify_exports


class VanillaExportTest(unittest.TestCase):
    def fixture(self):
        recipes = [
            {'id': 'test:smelt', 'origin': 'recipe_manager', 'recipe': {
                'type': 'minecraft:smelting', 'ingredient': {'item': 'test:ore'},
                'result': {'id': 'test:ingot', 'count': 1}, 'cookingtime': 160}},
            {'id': 'test:/smelt_exported_mi_furnace', 'origin': 'machine_recipe_provider', 'recipe': {
                'type': 'modern_industrialization:furnace', 'item_inputs': [{'item': 'test:ore', 'amount': 1}],
                'item_outputs': [{'item': 'test:ingot', 'amount': 1}], 'eu': 2, 'duration': 160}},
            {'id': 'test:cut', 'origin': 'recipe_manager', 'recipe': {
                'type': 'minecraft:stonecutting', 'ingredient': [{'item': 'test:stone'}, {'item': 'test:polished_stone'}],
                'result': {'id': 'test:slab', 'count': 2}}},
            {'id': 'test:/cut_exported_mi_cutting_machine', 'origin': 'machine_recipe_provider', 'recipe': {
                'type': 'modern_industrialization:cutting_machine',
                'item_inputs': [{'type': 'neoforge:compound', 'children': [
                    {'item': 'test:stone'}, {'item': 'test:polished_stone'}], 'amount': 1}],
                'item_outputs': [{'item': 'test:slab', 'amount': 2}],
                'fluid_inputs': [{'fluid': 'modern_industrialization:lubricant', 'amount': 1}],
                'eu': 2, 'duration': 200}},
            {'id': 'test:blast', 'origin': 'recipe_manager', 'recipe': {
                'type': 'minecraft:blasting', 'ingredient': {'item': 'test:ore'},
                'result': {'id': 'test:ingot', 'count': 1}, 'cookingtime': 80}}]
        catalog = {'recipes': [{'id': f'{row["recipe"]["type"]}|{row["id"]}'} for row in (recipes[1], recipes[3])]}
        return {'recipes': recipes}, catalog

    def test_generated_routes_keep_quantities_and_operating_costs(self):
        runtime, catalog = self.fixture()
        result = verify_exports(runtime, catalog)
        self.assertEqual((result['smelting_exported'], result['stonecutting_exported']), (1, 1))
        self.assertEqual(result['blasting_with_matching_smelting_input_and_output'], 1)
        self.assertEqual(result['unmatched_blasting'], [])

    def test_changed_lubricant_or_missing_catalog_route_fails(self):
        runtime, catalog = self.fixture()
        changed = copy.deepcopy(runtime)
        changed['recipes'][3]['recipe']['fluid_inputs'][0]['amount'] = 0
        with self.assertRaisesRegex(ValueError, 'lubricant'):
            verify_exports(changed, catalog)
        with self.assertRaisesRegex(ValueError, 'catalog lost'):
            verify_exports(runtime, {'recipes': catalog['recipes'][:1]})

    def test_tracked_report_keeps_released_counts_and_explicit_gap(self):
        path = Path(__file__).resolve().parents[2] / 'data/provenance/vanilla-export-report.json'
        report = json.loads(path.read_text(encoding='utf-8'))
        self.assertEqual((report['smelting_exported'], report['stonecutting_exported']), (256, 4322))
        self.assertEqual(report['blasting_with_matching_smelting_input_and_output'], 128)
        self.assertEqual(len(report['unmatched_blasting']), 16)
        for key in ('runtime_sha256', 'catalog_sha256'):
            self.assertRegex(report[key], r'^[0-9a-f]{64}$')


if __name__ == '__main__':
    unittest.main()
