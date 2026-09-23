# STI2 Factory Planner

This project uses stock Godot 4.7.2 and the GL Compatibility renderer. The workspace loads the compressed StaTech Industry 2.0.1 planning catalog from `data/statech-2.0.1.json.gz`. Its completeness flag remains false while process adapters and delivery requirements are unfinished. The fictional example remains available for regression checks and custom-dataset examples. World import reconstructs supported capacity goals with editable assignments. Do not present development exports as the finished product.

## Automatic project plans

Use [project-plans](.agents/skills/project-plans/SKILL.md) for every request in this project without waiting for explicit invocation. Search relevant history and docs, then create or resume a plan in the gitignored `.plans/` archive before substantive work. Keep scope, decisions, evidence, and remaining work current. Scale the plan to the task; it adds no approval step.

## Working rules

- Carry authorized work through implementation and relevant verification. Resolve routine, reversible choices without repeated approval. Keep changes within the requested scope.
- Keep development and scratch work on `F:/`. Use PowerShell from the repository root and explicit paths when running from another directory.
- Keep affected root and nested AGENTS.md files accurate. Put shared rules here and local rules in their owning directory.
- Use the installed `writing` skill for all prose and comments, and `agents-md` for every AGENTS.md edit.
- Use `godot-ui` for all Godot UI work, including small behavior fixes. Preserve its styling, redesign, animation, navigation, and visual-verification requirements. Use `godot-shaders` for shaders, materials, VFX, and visual styling, including small edits.
- Every work item needs a GitHub issue before implementation, including investigation, fixes, tests, documentation, and packaging. Use this repository's existing remote and `codex/` development branches. Link PRs to their issues, verify completed changes, then squash-merge with one descriptive commit. No external review or approval is required. Keep unfinished work off main and close completed issues. GitHub deletes merged branches automatically.
- Keep issue progress and decisions current across compaction. The full delivery is tracked in issue #2. Consult [delivery requirements](docs/delivery.md) when choosing scope or declaring completion.
- Keep downloaded game files, isolated instances, saves, and release artifacts out of Git. Use `F:/sti2-work` for extraction inputs and test instances. Bundle only data and assets whose redistribution terms have been recorded.
- The released StaTech Industry 2.0.1 pack is authoritative. Verify effective recipes and tags in the loaded pack and derive mechanics from matching code and runtime evidence. Never replace unsupported behavior with guessed values or free supplies.

## Guidance by task

| Work | Source |
|---|---|
| GDScript, resources, scenes, or class naming | [GDScript conventions](docs/gdscript_conventions.md) |
| Engine commands, MCP, or verification | [Godot tooling](docs/godot_tooling.md) |
| Pack inputs, runtime extraction, or machine rules | [Extraction evidence](docs/extraction.md) |
| Calculation kernel, objectives, or numerical checks | [Planning kernel](docs/planning-kernel.md) |
| Portable datasets, plans, or validation | [Dataset format](docs/dataset-format.md) |
| World ZIP, NBT, or AE2 import | [World import evidence](docs/world-import.md) |
| Workspace, exports, or application checks | [Application development](docs/application.md) |
| Visible UI, scenes, animation, materials, or effects | [visual-verify](.agents/skills/visual-verify/SKILL.md), alongside the relevant UI or shader skill |

Keep reusable calculations and planning rules independent of scene nodes when practical, so they can be tested without rendering. Choose concrete folders and state boundaries when implementing the relevant feature; record durable decisions in project docs.

## Verification

Use the configured Godot MCP when its inspection, runtime, or engine-documentation tools fit the task. Pass `F:/sti2-factory-planner` as the absolute project path. Use the stock engine documented in the tooling guide; `NG_Godot.exe` belongs to `F:/3-souls` only.

After adding or renaming a `class_name`, refresh the editor cache with a headless import. Run checks that cover the changed behavior and broaden them when failures or wider scope justify it. Do not claim a test framework exists before it is installed. Render and inspect every visual edit, fix visible defects, and distinguish static checks, isolated rendering, and confirmation in the actual application in the final report.

Core checks are `npm test`, `python -m unittest discover -s tools/extraction -p 'test_*.py'`, and the documented engine with `--headless --path . --script tools/test_data.gd` or `tools/test_ui.gd`. Exported browser checks and private capture commands are in the linked guides. Keep dataset objects immutable when saving undo snapshots; loading a dataset must replace the dictionary rather than mutate snapshots that share it.

Run `node tools/validate_dataset.mjs data/statech-2.0.1.json.gz` and the engine with `--headless --path . --script tools/test_bundled_data.gd` when changing the bundled catalog. Generate it with the documented extraction and distribution tools; do not hand-edit compressed data. Preserve its manifest, input hashes, attribution, and explicit unsupported entries.

Persist logical graph positions and group bounds, including when a recipe changes machine configuration. Do not replace saved group dimensions with rendered sizes during autosave; zoom can introduce rounding drift. Group, loadout-position, and layout regression commands are in the application guide. Keep shape reconstruction in `kernel/structure.js` separate from build-bill sizing in `kernel/structure_bill.js`.

Keep construction quantities separate from sustained flow rates. Construction costs can use continuous material equivalents or whole recipe batches and tools. Both assume reusable construction workstations; expected yields, initial catalysts, and bootstrap remain separate. Preserve those visible limits. Check it with `node tools/verify_construction_catalog.mjs`, `tools/test_construction_ui.gd`, and the exported `node tools/verify_construction_browser.mjs` interaction check.

Keep recipe display defaults separate from primary-route ownership. A feasible heuristic result must retain its unproven status and cost bound. Never infer feasibility from solver buffers alone. Check endgame calculations with `node tools/verify_endgame.mjs data/statech-2.0.1.json.gz <result.json>`, render that result with `tools/test_endgame_ui.gd -- <result.json>`, and use `--endgame` with the browser Worker parity check. Large construction optimization and graph responsiveness remain open work; do not treat these checks as full delivery.

Large construction requests compare complete fixed construction orders around a feasible production plan. Accept a route or loadout change only after its actual total cost and both balances pass; marginal prices alone are not evidence of an improvement. Retain verified loadout improvements before spending the remaining budget on alternative routes. This restricted search has no global cost bound. Use `node tools/verify_material_endgame.mjs data/statech-2.0.1.json.gz <result.json>` and add `--material` to the browser Worker check. Keep workstation and bootstrap assumptions visible. Progress files are temporary job files and must be cleaned up after completion, cancellation, or failure.

Periodic generation uses run-length profiles, whole lossless storage units, connected fuel and construction bills, and an explicit initial charge. Solar's uncertain cell gap needs one selected storage tier; its clear-weather and cable assumptions remain visible. Never treat its nominal daily average as firm power. Check `kernel/periodic_model.test.js`, `node tools/verify_solar_catalog.mjs data/statech-2.0.1.json.gz`, `tools/test_solar_ui.gd`, and the browser Worker with `--solar`. Regenerate the solar report from the private loaded-world capture and add routes with `tools/extraction/add_solar_routes.py`; keep the report hash in the bundled source record.

The charged-world ZIP check is `node tools/verify_storage_world.mjs <world.zip> <fixture.json> data/statech-2.0.1.json.gz <report.json>`. Preserve exact saved `storedEu` as a quantity in `reconstruction.storage_units`. Storage has no recipe or output goal. Players can select storage for a power plan, but imported saved units and charges are not applied to those selections yet; issue #41 tracks that work. Regenerate the bundled rules through `merge_storage_rules.py`, `player_dataset.py`, and `bundle_dataset.py`, retaining the verified rotation capture and the storage report hash.

Keep every positive flow in decoded plans. An absolute solver tolerance must not erase a tiny goal, ingredient, or construction quantity. Numerical recovery must pass the original-unit balances and whole-machine checks; report an explicit failure if it cannot. Row scaling changes dual units, so convert marginal costs back before using them. `kernel/tiny_rates.test.js` covers these boundaries and exact finite-goal time.

Use `PlannerJson.parse` at Godot data boundaries and full-precision `JSON.stringify` for calculation requests and saved plans. Native decimal conversion can change values even in scientific notation. Preserve exact midpoint rounding, ties, and signed zero; compare bits against the Python references from `tools/make_decimal_cases.py` with `tools/test_json.gd`. `tools/verify_dataset_roundtrip.mjs` checks the complete dataset after Godot serialization. Read stepped goal controls through `PlannerDisplay.input_value` to preserve their displayed decimal value.

Autosave keeps immutable datasets separately by content hash; portable exports still embed them. Keep the prior plan recoverable if a dataset write fails. Verify storage changes with `tools/test_ui.gd`, `node tools/verify_storage_browser.mjs`, and the exported application checks.

Registered machines are not necessarily obtainable in the released pack. Preserve the recorded automatic exclusions when generating defaults and progression presets, while allowing explicit owned-machine overrides. Check them with `node tools/verify_availability_catalog.mjs` and `tools/test_availability_ui.gd`; the archive comparison is documented in the extraction guide.

Equal-material route preferences must preserve exact normalized input and output quantities, explicit player choices, and feasibility. Keep metadata references valid when making a dataset subset with `withRecipes`. Check the released crafting/assembly pairs with `node tools/verify_recipe_preferences.mjs`; do not infer equal upstream costs from different immediate ingredients.

Read world archives through bounded ranges on desktop and web. Do not turn a selected browser File into a whole-archive ArrayBuffer. Preserve checksum and size checks and consume region chunks separately. Reader parity, large-archive fixtures, and exported import recovery commands are in the world import guide. Directional multiblock states need captured world-state rotations; check all four controlled quarry orientations with `tools/verify_rotation_world.mjs` when changing shape rules. Optional desktop progress updates must tolerate Windows file-sharing conflicts without failing the calculation.

Build desktop and web exports in clean ignored `builds/windows` and `builds/web` directories. Run `python tools/test_package_exports.py` and `python tools/package_exports.py` to check their file lists, runtime hash, notices, and archive checksums. The packages remain labeled development exports until #8 and the delivery requirements are complete; verify the extracted application before publishing.

Distinct Spectrum blasting routes use the loaded blast-furnace trials in `data/provenance/blasting-report.json`. Regenerate them from the private capture with `player_dataset.py --blasting-report`, then run `node tools/verify_blasting_catalog.mjs <catalog.json>`. Keep other furnace fuels unsupported until measured.

Saved blast furnaces use input, active progress, queued fuel, and matching cook time to infer a configured route. Recipe history and stored output never establish a sustained goal. Keep ambiguous saves editable, with their world origins and facts. Check the real ZIP with `node tools/verify_blasting_world.mjs`, the review UI with `tools/test_blasting_world_ui.gd`, and both exports with `tools/verify_blasting_desktop.mjs` and `tools/verify_blasting_app_browser.mjs`. The exact arguments and private fixture steps are in the world import guide.

Color Picker ink routes use the loaded recipes and controlled trial in `data/provenance/spectrum-ink-report.json`. Regenerate them with `tools/extraction/add_spectrum_ink_routes.py`, then run `node tools/verify_spectrum_ink_catalog.mjs data/statech-2.0.1.json.gz` and the browser Worker check with `--ink`. The machine's stored ink is verified; passive Crystallarieum harvest and ink delivery remain open in #49.
