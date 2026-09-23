import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from package_exports import (PREVIEW_VERSION, WEB_REQUIRED, WINDOWS_REQUIRED,
                             digest, package, validate_itch_contents, verify_archive)


class PackageExportsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ("data/ATTRIBUTION.md", "data/licenses/pack.txt", "ui/fonts/OFL.txt",
                     "docs/mi-preview.md",
                     "data/statech-2.0.1.json.gz"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture")

    def export(self, kind):
        directory = self.root / kind
        required = WINDOWS_REQUIRED if kind == "windows" else WEB_REQUIRED
        for name in required:
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture")
        if kind == "windows":
            (directory / "runtime-manifest.json").write_text(json.dumps({
                "godot": "4.7.2", "release_ready": False,
                "node_sha256": digest(b"fixture")}), encoding="utf-8")
        else:
            (directory / "index.html").write_text('<script src="bridge.js"></script>', encoding="utf-8")
        return directory

    def test_archive_inventory_hashes_and_repeatability(self):
        for kind in ("windows", "web"):
            with self.subTest(kind=kind):
                directory = self.export(kind)
                archive = self.root / f"{kind}.zip"
                first = package(kind, directory, archive, self.root)
                self.assertEqual(first, package(kind, directory, archive, self.root))
                verify_archive(archive)
                with zipfile.ZipFile(archive) as zipped:
                    manifest = json.loads(zipped.read("package-manifest.json"))
                    self.assertFalse(manifest["release_ready"])
                    self.assertEqual(manifest["source_dataset_sha256"], digest(b"fixture"))
                    self.assertIn("notices/ATTRIBUTION.md", zipped.namelist())

    def test_missing_or_stale_export_file_is_rejected(self):
        directory = self.export("web")
        (directory / "vendor/highs.wasm").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            package("web", directory, self.root / "web.zip", self.root)
        (directory / "vendor/highs.wasm").write_bytes(b"fixture")
        (directory / "kernel/old-worker.js").write_bytes(b"stale")
        with self.assertRaisesRegex(ValueError, "Unexpected file"):
            package("web", directory, self.root / "web.zip", self.root)

    def test_preview_archives_keep_full_release_status_and_include_instructions(self):
        for kind in ("windows", "web"):
            with self.subTest(kind=kind):
                archive = self.root / f"{kind}-preview.zip"
                package(kind, self.export(kind), archive, self.root, preview=True)
                with zipfile.ZipFile(archive) as zipped:
                    manifest = json.loads(zipped.read("package-manifest.json"))
                    self.assertEqual(manifest["app_version"], PREVIEW_VERSION)
                    self.assertEqual(manifest["track"], "mi-production-preview")
                    self.assertTrue(manifest["preview_ready"])
                    self.assertFalse(manifest["release_ready"])
                    self.assertIn("PREVIEW.md", zipped.namelist())
                    if kind == "web":
                        self.assertIn("index.html", zipped.namelist())

    def test_itch_archive_rejects_a_path_beyond_its_hosting_limit(self):
        with self.assertRaisesRegex(ValueError, "240 characters"):
            validate_itch_contents({"a" * 241: self.root / "data/ATTRIBUTION.md"})

    def test_modified_runtime_is_rejected(self):
        directory = self.export("windows")
        (directory / "runtime/node.exe").write_bytes(b"modified")
        with self.assertRaisesRegex(ValueError, "differs"):
            package("windows", directory, self.root / "windows.zip", self.root)


if __name__ == "__main__":
    unittest.main()
