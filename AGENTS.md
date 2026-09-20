# STI2 Factory Planner

This repository starts as a stock Godot 4.7.2 GDScript project using the GL Compatibility renderer. There is no main scene, application architecture, or test framework yet. Check the current files before relying on that starting state; update these facts as the application grows.

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
| Visible UI, scenes, animation, materials, or effects | [visual-verify](.agents/skills/visual-verify/SKILL.md), alongside the relevant UI or shader skill |

Keep reusable calculations and planning rules independent of scene nodes when practical, so they can be tested without rendering. Choose concrete folders and state boundaries when implementing the relevant feature; record durable decisions in project docs.

## Verification

Use the configured Godot MCP when its inspection, runtime, or engine-documentation tools fit the task. Pass `F:/sti2-factory-planner` as the absolute project path. Use the stock engine documented in the tooling guide; `NG_Godot.exe` belongs to `F:/3-souls` only.

After adding or renaming a `class_name`, refresh the editor cache with a headless import. Run checks that cover the changed behavior and broaden them when failures or wider scope justify it. Do not claim a test framework exists before it is installed. Render and inspect every visual edit, fix visible defects, and distinguish static checks, isolated rendering, and confirmation in the actual application in the final report.
