# STI2 Factory Planner

The MI production preview lets players choose a StaTech Industry 2.0.1 recipe goal and inspect its connected material plan, whole machines, upgrades, and exact deterministic rates. The desktop and browser builds use the same bundled catalog and can exchange portable plans. [Preview instructions](docs/mi-preview.md) explain the supported workflow and how to run either build. The full product is still under development: the catalog contains 29,129 planning routes and 12,042 resources, including entries with explicit unsupported behavior. [Issue #2](https://github.com/kurushimee/sti2-factory-planner/issues/2) tracks the complete delivery after players evaluate this preview.

The reference pack is StaTech Industry 2.0.1 for Minecraft 1.21.1 and NeoForge 21.1.250. Runtime extraction tools capture effective recipes, tags, upgrade and fuel values, and machine evidence from an isolated copy of the released server. The recorded capture includes 26,481 recipe/type pairs and 211 machine probes. This evidence is not yet a complete normalized planner dataset.

The calculation kernel uses the same HiGHS WebAssembly build in Node and a browser Worker. The Godot workspace supports goals, selectable production routes and ingredients, supplier and consumer navigation, resource connections, local groups, undo/redo, and portable plans. Plan details separates running power draw from the sum of installed machine peak ratings. New plans enable the supported StaTech machine set in production-only mode with external electricity. Settings can narrow progression, and New plan clears a restored workspace with Undo available. Generation optimization and complete world reconstruction remain outside the preview acceptance gate. Existing solar, storage, and import work stays available with its recorded limits.

See [delivery requirements](docs/delivery.md), [extraction instructions](docs/extraction.md), [kernel behavior and limits](docs/planning-kernel.md), and [Godot tooling](docs/godot_tooling.md). Keep downloaded game files, saves, and extraction instances outside this repository.

The catalog is a compressed JSON file read internally by both builds. Players do not need extraction tools. See [data attribution](data/ATTRIBUTION.md) and [distribution checks](docs/distribution.md) for its contents and source records. This is an unofficial Minecraft companion application, not approved by or associated with Mojang or Microsoft.

Run the current checks from the repository root:

```powershell
python tools/check.py
python -m unittest discover -s tools/extraction -p 'test_*.py'
npm ci --ignore-scripts
New-Item -ItemType File -Force node_modules/.gdignore
npm test
```

See [application development](docs/application.md) for build, preview archive, and exported-application checks, and [world import evidence](docs/world-import.md) for the controlled save fixture. Browser checks require Playwright's Chromium installation. Keep builds and worlds out of Git. Run `python tools/package_exports.py --preview` after exporting both platforms to make the versioned Windows and itch.io ZIPs with checksums.
