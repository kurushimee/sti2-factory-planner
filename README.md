# STI2 Factory Planner

This project is under development. The desktop and browser workspace runs a fictional example dataset; the complete StaTech dataset and planning features are still in progress. Development exports are not a finished release. [Issue #2](https://github.com/kurushimee/sti2-factory-planner/issues/2) tracks the complete delivery.

The reference pack is StaTech Industry 2.0.1 for Minecraft 1.21.1 and NeoForge 21.1.250. Runtime extraction tools capture effective recipes, tags, upgrade and fuel values, and machine evidence from an isolated copy of the released server. The recorded capture includes 26,481 recipe/type pairs and 211 machine probes. This evidence is not yet a complete normalized planner dataset.

The calculation kernel uses the same HiGHS WebAssembly build in Node and a browser Worker. The Godot workspace supports goals, resource connections, inspection, movable and resizable groups, undo/redo, and portable plans. The world reader recovers tested MI configuration and both AE2 provider forms, but complete production-line reconstruction is unfinished.

See [delivery requirements](docs/delivery.md), [extraction instructions](docs/extraction.md), [kernel behavior and limits](docs/planning-kernel.md), and [Godot tooling](docs/godot_tooling.md). Keep downloaded game files, saves, and extraction instances outside this repository.

Run the current checks from the repository root:

```powershell
python tools/check.py
python -m unittest discover -s tools/extraction -p 'test_*.py'
npm ci --ignore-scripts
New-Item -ItemType File -Force node_modules/.gdignore
npm test
```

See [application development](docs/application.md) for current build and exported-application checks, and [world import evidence](docs/world-import.md) for the controlled save fixture. Browser checks require Playwright's Chromium installation. Keep development builds and worlds out of Git.
