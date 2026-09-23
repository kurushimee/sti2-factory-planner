"""Check loaded vanilla recipes against MI's generated automation routes."""

import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def converted_ingredient(raw):
    if isinstance(raw, list):
        return {'type': 'neoforge:compound', 'children': raw, 'amount': 1}
    return {**raw, 'amount': 1}


def verify_exports(runtime, catalog):
    by_id = {entry['id']: entry for entry in runtime['recipes']}
    if len(by_id) != len(runtime['recipes']):
        raise ValueError('The loaded recipe capture has duplicate IDs.')
    available = {entry['id'] for entry in catalog['recipes'] if not entry.get('unsupported')}
    pairs = []
    for source_type, target_type, suffix in (
            ('minecraft:smelting', 'modern_industrialization:furnace', '_exported_mi_furnace'),
            ('minecraft:stonecutting', 'modern_industrialization:cutting_machine', '_exported_mi_cutting_machine')):
        count = 0
        for source in (entry for entry in runtime['recipes'] if entry['recipe']['type'] == source_type):
            namespace, path = source['id'].split(':', 1)
            exported_id = f'{namespace}:/{path}{suffix}'
            exported = by_id.get(exported_id)
            if not exported or exported['recipe']['type'] != target_type or exported['origin'] != 'machine_recipe_provider':
                raise ValueError(f'No loaded MI export matches {source["id"]}.')
            raw, target = source['recipe'], exported['recipe']
            if target['item_inputs'] != [converted_ingredient(raw['ingredient'])]:
                raise ValueError(f'Ingredient conversion changed in {source["id"]}.')
            if target['item_outputs'] != [{'item': raw['result']['id'], 'amount': raw['result'].get('count', 1)}]:
                raise ValueError(f'Output conversion changed in {source["id"]}.')
            if target['eu'] != 2 or target['duration'] != (raw['cookingtime'] if source_type == 'minecraft:smelting' else 200):
                raise ValueError(f'MI power or duration changed in {source["id"]}.')
            if source_type == 'minecraft:stonecutting' and target['fluid_inputs'] != [
                    {'fluid': 'modern_industrialization:lubricant', 'amount': 1}]:
                raise ValueError(f'MI cutting lubricant changed in {source["id"]}.')
            if f'{target_type}|{exported_id}' not in available:
                raise ValueError(f'The player catalog lost {exported_id}.')
            pairs.append((source['id'], exported_id))
            count += 1
        expected = sum(entry['recipe']['type'] == source_type for entry in runtime['recipes'])
        if count != expected:
            raise ValueError(f'Not every {source_type} recipe was checked.')
    smelting = {(json.dumps(entry['recipe']['ingredient'], sort_keys=True), entry['recipe']['result']['id'],
                 entry['recipe']['result'].get('count', 1))
                for entry in runtime['recipes'] if entry['recipe']['type'] == 'minecraft:smelting'}
    unmatched = [entry['id'] for entry in runtime['recipes'] if entry['recipe']['type'] == 'minecraft:blasting' and
                 (json.dumps(entry['recipe']['ingredient'], sort_keys=True), entry['recipe']['result']['id'],
                  entry['recipe']['result'].get('count', 1)) not in smelting]
    return {'smelting_exported': sum(entry['recipe']['type'] == 'minecraft:smelting' for entry in runtime['recipes']),
            'stonecutting_exported': sum(entry['recipe']['type'] == 'minecraft:stonecutting' for entry in runtime['recipes']),
            'blasting_with_matching_smelting_input_and_output': sum(entry['recipe']['type'] == 'minecraft:blasting'
                                                                   for entry in runtime['recipes']) - len(unmatched),
            'unmatched_blasting': sorted(unmatched),
            'source_namespaces': dict(sorted(Counter(source.split(':', 1)[0] for source, _ in pairs).items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    runtime = json.loads(args.runtime.read_text(encoding='utf-8'))
    catalog = json.loads(gzip.decompress(args.catalog.read_bytes()))
    result = verify_exports(runtime, catalog)
    report = {'pack': 'StaTech Industry 2.0.1', 'runtime_sha256': digest(args.runtime),
              'catalog_sha256': digest(args.catalog),
              'scope': 'The loaded recipe provider converted vanilla smelting and stonecutting to supported MI furnace and cutting-machine processes. These converted routes use their captured EU, duration, and lubricant, not a free manual workstation.',
              'limits': ['Matching outputs do not prove that a vanilla blasting machine has the same throughput or fuel use.',
                         'Sixteen Spectrum blasting-only inputs remain without a matching smelting route.'],
              **result}
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(f'Verified {result["smelting_exported"]} smelting and {result["stonecutting_exported"]} stonecutting MI exports; {len(result["unmatched_blasting"])} blasting inputs remain distinct.')


if __name__ == '__main__':
    main()
