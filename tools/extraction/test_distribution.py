from io import BytesIO
import gzip
import json
import unittest
import zipfile

from audit_distribution import archive_records
from bundle_dataset import encode_bundle


class DistributionTests(unittest.TestCase):
    def test_nested_mod_declarations_and_recipe_namespaces_are_recorded(self):
        def archive(files):
            result = BytesIO()
            with zipfile.ZipFile(result, "w") as output:
                for name, content in files.items():
                    output.writestr(name, content)
            return result.getvalue()
        inner = archive({"fabric.mod.json": json.dumps({"id": "library", "version": "1", "license": "MIT"})})
        outer = archive({"META-INF/neoforge.mods.toml": 'license="Custom terms"\n[[mods]]\nmodId="example"\nversion="2"',
                         "META-INF/jarjar/library.jar": inner, "LICENSE.txt": "License evidence.",
                         "data/different_namespace/recipe/example.json": "{}"})
        records = archive_records(outer, "example.jar")
        self.assertEqual(records[0]["mods"][0]["license"], "Custom terms")
        self.assertEqual(records[0]["recipe_namespaces"], ["different_namespace"])
        self.assertEqual(records[0]["license_files"][0]["path"], "LICENSE.txt")
        self.assertEqual(records[1]["mods"][0]["id"], "library")

    def test_bundle_is_deterministic_and_preserves_the_json(self):
        dataset = {"format": 1, "resources": [{"id": "test", "name": "Test"}], "recipes": []}
        encoded, packed = encode_bundle(dataset)
        self.assertEqual(encode_bundle(dataset), (encoded, packed))
        self.assertEqual(json.loads(gzip.decompress(packed)), dataset)
        dataset["original_scripts"] = "Unreviewed code"
        with self.assertRaisesRegex(ValueError, "Unreviewed distribution fields"):
            encode_bundle(dataset)
