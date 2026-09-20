---
name: visual-verify
description: Capture and inspect the rendered result after visible Godot UI, scene, animation, or presentation changes in this project.
---

# Verify the rendered result

Reach the changed state using the stock Godot executable and renderer in [the tooling guide](../../../docs/godot_tooling.md). Apply the relevant `godot-ui` or `godot-shaders` skill's quality requirements alongside this capture workflow.

Capture the viewport after `RenderingServer.frame_post_draw` using `get_viewport().get_texture().get_image()`, save a PNG under `.plans/artifacts/<topic>/`, and inspect it. Capture with rendering enabled; a headless import cannot verify appearance. Use a stable viewport size and include relevant resize states when layout changes.

Use direct state setup unless input routing is the subject. Inspect the affected state and nearby states needed to expose a likely regression. Judge hierarchy, clipping, rendered text, control states, focus, keyboard/gamepad behavior, and motion where applicable. Fix visible defects and inspect a fresh capture.

Use the real project where possible. If it cannot reach the state yet, render the affected scene and resources in an isolated stock-Godot harness on `F:/`, preserving relevant theme, renderer, lighting, and inputs. Report that evidence as isolated rather than integrated application verification.

Add a temporary probe only when needed. A standalone `--script` SceneTree does not initialize project autoloads; use a temporary scene or autoload when the state depends on them. Restore any project configuration or user settings changed by the probe, remove only task-owned probes, and retain useful captures.

Report the inspected scenario, capture paths, concrete findings, and remaining limitations. If rendering is blocked, state the blocker and the unverified visual behavior.
