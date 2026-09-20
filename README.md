# STI2 Factory Planner

This project is under development. There is no usable desktop or browser application or release build yet. [Issue #2](https://github.com/kurushimee/sti2-factory-planner/issues/2) tracks the complete delivery.

The reference pack is StaTech Industry 2.0.1 for Minecraft 1.21.1 and NeoForge 21.1.250. Runtime extraction tools capture effective recipes, tags, upgrade and fuel values, and machine evidence from an isolated copy of the released server. The recorded capture includes 26,481 recipe/type pairs and 211 machine probes. This evidence is not yet a complete normalized planner dataset.

The development calculation kernel uses the same HiGHS WebAssembly build in Node and a browser Worker. It has focused regression checks for capacity, shared demand, recycling, concrete machine counts, route choices, and generation support costs. It is not yet connected to a Godot interface.

See [delivery requirements](docs/delivery.md), [extraction instructions](docs/extraction.md), [kernel behavior and limits](docs/planning-kernel.md), and [Godot tooling](docs/godot_tooling.md). Keep downloaded game files, saves, and extraction instances outside this repository.

Run the current checks from the repository root:

```powershell
python tools/check.py
python -m unittest discover -s tools/extraction -p 'test_*.py'
npm ci --ignore-scripts
New-Item -ItemType File -Force node_modules/.gdignore
npm test
```

Browser computation checks require Playwright's Chromium installation; see the kernel guide. These checks do not replace testing the finished desktop and web exports. Build, world-import, dataset-format, and publishing instructions will accompany those implemented features.
