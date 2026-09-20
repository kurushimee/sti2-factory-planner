# World import evidence

Issue #7 tracks the complete importer. The current shared JavaScript reader is an internal library, not yet an application feature.

`kernel/world.js` reads ZIP directory entries individually, verifies their checksums, and decodes region chunks and big-endian NBT. It retains signed 64-bit NBT values as decimal strings. It recognizes wrapper directories, the vanilla dimensions, and namespaced dimension folders. Malformed chunks produce entries in the import report rather than deleting successfully read machines. Current limits are 256 MiB per archive entry, 32 MiB per expanded chunk, 128 NBT nesting levels, and two million NBT collection entries. ZIP64 and LZ4 region compression currently produce explicit unsupported-format errors.

The machine adapter reads `activeRecipe`, `upgradesItemStack`, `machinesStack`, `activeShape`, and `casing` from the matching MI and addon serialization. The contained machine determines an array's recipe type. Unrecognized mod block entities retain their coordinates and raw facts for later adapters or correction. These facts establish saved configuration, not measured throughput.

The AE2 adapter follows version 19.2.17, source tag `neoforge/v19.2.17`, commit `79ee2c704ad62941a426c26b1cb1f76ef5b2ee5a`. `PatternProviderLogic`, `AppEngInternalInventory`, `CableBusContainer`, `EncodedProcessingPattern`, `EncodedCraftingPattern`, and `GenericStack` define the fields. Pattern inventories contain item stacks with `Slot` and encoded components. Cable parts are stored under direction names. Block providers use the block-state `push_direction` property. Processing patterns carry `sparseInputs` and `sparseOutputs`, with AE resource type `#t` and quantity `#`.

Patterns remain provider configuration. They do not create production machines. An unassigned adjacent machine receives an inferred recipe only when its recipe type and the pattern's material quantities match a single normalized process. Multiple matches remain ambiguous. Saved active recipes take precedence. Remote networks, multiblock hatch relationships, requester settings, and end-goal reconstruction still need adapters and verification.

## Reproduce the controlled world check

Use the isolated instance described in [extraction evidence](extraction.md). Apply `tools/extraction/fixture-commands.txt` after the server starts. The commands configure four machines at y=100. They do not form the multiblocks or measure production. Run `planner_fixture_ae2` to place a block provider and a cable-mounted provider with a copper-cluster processing pattern through AE2's actual APIs. Save and stop the server before archiving its world.

Run `node tools/verify_world_capture.mjs <world.zip> <machines.json> <report.json>`. The fixture check requires the macerator's assigned recipe and eight advanced upgrades, an unassigned assembler, a singleblock array containing 16 macerators and four turbo upgrades, and a multiblock array containing eight distillation towers. Keep the world archive outside Git. The compact report records its digest and selected facts.

Run `node tools/verify_kernel_browser.mjs <world.zip> <machines.json>` to compare the actual archive's import in Node and a browser Worker inside a cross-origin iframe. This is an isolated computation test, not verification of an exported Godot application. Run `npm test` for synthetic NBT, ZIP, region, AE2, capacity, and planning regressions.
