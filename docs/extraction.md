# Runtime extraction evidence

Issue #3 covers the complete dataset and mechanics. The tools here capture evidence from the released pack; they do not yet produce a complete planner dataset.

## Reference inputs

The CurseForge 2.0.1 client archive and the GitHub 2.0.1 client release have identical SHA-256 hashes: `7c39a9cd56b52e320fdfdb72300bc3317f51bf02feaec0a358a46f3123deaa4d`. The GitHub server archive is `7bf868078e1c403b1a264baeafab8c5e443f2ffbc33484347438fc894e45ce8f`. The manifest specifies Minecraft 1.21.1 and NeoForge 21.1.250. `data/provenance/sources.json` records archive and source revision identities. `statech-2.0.1-inputs.json` records every released server mod archive, declared version and license, and every pack script and configuration input hash.

The release contains MI 2.5.8, EI 1.16.2, IO 1.14.0, YAI 1.6.3, MI Tweaks 1.9.5, Tesseract API 1.12.16, StaTech Companion 1.0.3, and AE2 19.2.17. Source checkouts are pinned; the IO and YAI source heads declare the matching versions but still need bytecode comparisons for each calculation rule used.

## Reproduce the capture

Keep downloads and worlds outside the repository, such as `F:/sti2-work`. Download the client and server archives from the recorded release, unpack both, and make a separate working copy of the server. Install Java 21 and NeoForge 21.1.250 in that working copy using the official installer. Bind the test server to localhost. Do not use a player's existing world for instrumentation.

Run `python tools/extraction/inventory.py --server <unmodified-server-directory> --client <unmodified-client-directory> --output <inventory.json>` before modifying the instance. The output must match the pinned inventory.

Copy `tools/extraction/runtime_export.js` to the isolated instance's `kubejs/server_scripts/zz_planner_export.js`. Run `python tools/extraction/build_probe.py --instance <instance> --jdk <jdk-directory> --work <private-build-directory>`, then copy the resulting `planner-probe.jar` into the instance's `mods` folder. Restart the server after changing the Java probe.

After startup and all runtime recipe injection have finished, run `planner_export` and `planner_probe` in the server console. KubeJS script changes require `reload` before running the export again. Read `planner-extraction/runtime.json` and `planner-extraction/machines.json`. A success line is not sufficient: inspect the failure arrays, expected counts, and arithmetic samples. Keep the complete console log privately to distinguish pack warnings from extraction failures.

For a prepared Windows instance, `python tools/extraction/run_capture.py --instance <instance> --jdk <jdk-directory>` starts the server, waits for startup, runs both commands, and stops it. Run `python tools/extraction/verify_capture.py --capture <instance>/planner-extraction --output <report.json>` to validate the pinned counts, tag membership, array eligibility, and arithmetic. Use `--compare <previous-runtime.json>` to require a repeated capture to have identical content after canonical ordering. The compact report records actual loaded mod versions, including nested dependencies. Run the extraction regression checks with `python -m unittest discover -s tools/extraction -p 'test_*.py'`.

The recipe export reads both the recipe manager and every MI machine recipe provider. The latter supplies thousands of recipes absent from the manager, including generated canning and proxied smelting recipes. Recipe identity includes recipe type and ID because proxy recipes can share an ID with their source recipe. The TaCZ adapter records resolved ingredients and output components when that mod's serializer cannot encode its runtime recipe.

The machine probe creates detached block entities in the loaded server context and reads their actual components, capacities, batch limits, array eligibility, and serialized NBT. These are configuration probes, not functioning world machines. Batch energy probes use a known operation energy and the loaded transform. Arithmetic samples invoke the actual MI crafter method. Physical multiblock formation, throughput, and full warm-up behavior still require controlled world tests.

## Calculation findings

MI's base singleblock electric limit is 32 EU/t and its base overclock rate is 8 EU/t. Upgrades add to the limit. For a recipe with total energy E, recipe EU/t R, base B, maximum M, and efficiency counter e, the source computes `min(E, M, max(B, R) + floor(e * E / 600))`. The efficiency counter increases on completed recipes, not on every elapsed tick. The last tick consumes only the remaining energy. A planner must use whole ticks and the completion recurrence when estimating warm-up.

Tesseract's batching crafter transforms energy and base limits with the batch multiplier and discount, while adding upgrade energy separately. It casts floating-point transformed values to integers. Applying singleblock upgrade behavior independently to every internal machine would be wrong. The loaded Large Scale Assembler reports batch size 16, base 8 EU/t, base maximum 32 EU/t, and a 1,000,000 EU probe transforms to 13,600,000 EU for its full batch.

The two processing arrays accept different machine classes. The singleblock array accepts eligible electric singleblock machines; the multi-processing array accepts eligible MI electric multiblocks. Batching replacement machines do not automatically qualify for either. A controlled attempt to put the Large Scale Assembler into a multi-processing array was rejected by the actual mod class cast; do not expose that combination as valid.

The loaded MI Tweaks configuration has constant-efficiency hacks and casing-based overclock overrides disabled. Its redstone lock option is also disabled. Record these settings alongside extracted rules rather than assuming upstream defaults.

The machine probe also records primitive component fields and evaluates each loaded generator's fuel acceptance against the item and fluid registries. The fuel map's own enumeration method is unavailable for dynamic fluid fuels, so registry enumeration must call `accept` and `getEuProduction`. There are 12 captured generator configurations. The LV diesel generator supplies up to 64 EU/t and converts diesel at 800 EU/mB after its loaded multiplier; the large steam turbine supplies up to 16,384 EU/t and accepts four steam variants. The compact report retains the full verified fuel mappings. Boiler heating, pumping, and other generator families still need their own process adapters.

## Remaining verification

`python tools/extraction/normalize.py --capture <capture-directory> --output <private-output.json>` produces an intermediate capture format with version 1. It retains every source recipe, resolves item and fluid tag alternatives, preserves catalyst probabilities and process conditions, and reports unsupported ingredient and process adapters. The current reference capture yields 17,148 normalized processes and 9,333 explicitly unsupported entries. All 10,024 MI-style processes normalize. Component-bearing resources have stable identities; component predicates retain their captured matching display variants and the predicate itself. Those display variants do not establish every possible matching component combination. A normalized process is not a verified machine allocation: recipe-specific remainders, automation capacity, conditions, and machine-specific adapters must still be supplied. Keep this intermediate output private until the bundled dataset's redistribution audit and final format are complete.

The Java probe calls the loaded replication predicate, burn-time method, and crafting-remainder method for 11,573 default item stacks. It also decodes 202 distinct custom ingredient records through the loaded ingredient codec and verifies that each displayed stack satisfies its predicate. Both probes have zero failures. Default item metadata does not establish behavior for arbitrary component variants or recipe-specific remainder overrides. Loaded power conversion is 10 FE per EU and 2 FE per AE, with AE usage multiplier 1. The matching AE2 molecular assembler code ticks every game tick, has five acceleration-card slots, and charges the full final processing tick; its capacity evaluator includes that rounding.

A fresh-start repeated capture passed canonical comparison for all 26,481 recipes, resources, tags, and data maps. Both capture files had empty failure lists, and the machine report contained 211 entries. `data/provenance/runtime-report.json` records the counts, content digest, loaded mod versions, and arithmetic samples. The reference server emits unrelated optional-mod recipe warnings during startup and a configuration-unload exception during shutdown; the completed capture and its validation are separate from those pack log messages.

This capture does not establish full dataset coverage, redistribution approval for arbitrary mod assets, normalized process adapters, generation and closed-loop rules, complete upgrade compatibility, recipe conditions, warm-up buffers, or real-save reconstruction. No textures, mod jars, or worlds belong in the repository. Keep all unsupported recipe types and mechanics visible in the eventual dataset coverage report.
