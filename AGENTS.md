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

Persist logical graph positions and group bounds. Do not replace saved group dimensions with rendered sizes during autosave; zoom can introduce rounding drift. Group and layout regression commands are in the application guide. Keep shape reconstruction in `kernel/structure.js` separate from build-bill sizing in `kernel/structure_bill.js`.

Keep construction quantities separate from sustained flow rates. Construction costs can use continuous material equivalents or whole recipe batches and tools. Both assume reusable construction workstations; expected yields, initial catalysts, and bootstrap remain separate. Preserve those visible limits. Check it with `node tools/verify_construction_catalog.mjs`, `tools/test_construction_ui.gd`, and the exported `node tools/verify_construction_browser.mjs` interaction check.

Keep recipe display defaults separate from primary-route ownership. A feasible heuristic result must retain its unproven status and cost bound. Never infer feasibility from solver buffers alone. Check endgame calculations with `node tools/verify_endgame.mjs data/statech-2.0.1.json.gz <result.json>`, render that result with `tools/test_endgame_ui.gd -- <result.json>`, and use `--endgame` with the browser Worker parity check. Large construction optimization and graph responsiveness remain open work; do not treat these checks as full delivery.

Use `PlannerJson.parse` at Godot data boundaries and full-precision `JSON.stringify` for calculation requests and saved plans. The stock parser truncates significant digits in small decimal tokens; `tools/test_json.gd` and `tools/test_computation.gd` cover the workaround.
