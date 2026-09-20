# Application development

The current workspace is a development application using `data/example.json`, a fictional dataset. It is not the requested StaTech release. Issues #3 and #5 through #8 track the remaining dataset, planning, editing, reconstruction, and verification work.

Open the project with stock Godot 4.7.2 and run `ui/workspace.tscn`. Development desktop calculations use Node 24 and the installed npm dependencies. Released Windows packages include their own Node executable. Browser calculations run in single-threaded Workers; the Godot export also has thread support disabled.

The interface uses charcoal surfaces, copper focus accents, teal material flows, and Inter typography. The font is distributed under the included SIL Open Font License in `ui/fonts/OFL.txt`; its source is Google Fonts' `ofl/inter` directory. `tools/build_theme.py` generates the shared theme. The original SVG mark represents connected production nodes. Motion is limited to a short graph update fade, with a reduced-motion control.

Interface sounds are quiet and opt-in. `tools/build_ui_audio.py` generates the original tones, which play through the authored UI audio bus. Sound and reduced-motion preferences are saved with the plan. Tab and gamepad shoulder buttons follow the main focus order. With the graph focused, arrow keys or the D-pad select and center nearby nodes; confirm opens the goal editor and cancel returns to search. Recalculation keeps the inspected line when it still exists; the import review has its own focus loop. `tools/test_ui.gd` checks keyboard and shoulder-button navigation and measures a mixed confirmation tone. The heuristic UI audit misses the audio players inside the instanced Node scene; the resource and mixer checks establish that they are connected.

The Imported factory dialog shows machine origins, saved upgrades, recipe evidence, and compatible recipe choices. Applying corrections recalculates inferred capacity goals and preserves unresolved entries. The real-catalog browser check also covers undo across dataset changes and removing the final imported goal. The production-goal editor supports rate, finite quantity, and whole-machine capacity targets. It previews supported machines, upgrades, batches, array contents, and structure variants before applying a change. Existing imported goals retain their world origins. Progression presets and large-catalog performance still need work.

Group membership uses node centers. When groups overlap, the smallest enclosing boundary wins; equal areas use the stable group ID. Group movement translates members. Resizing changes the boundary and recalculates membership without translating or resizing recipes. The application implements this explicitly because Godot's automatic frame attachment fits boundaries around attached nodes.

## Development builds

Run `npm ci --ignore-scripts` and keep `node_modules/.gdignore` present. Import the Godot project once before checking scripts, because the font needs its generated import resource. A clean first import can report the temporarily unavailable theme font; the subsequent import and runtime must have no errors.

For Windows, run `node tools/build_desktop.mjs`, then export the `Windows Desktop` preset. The default output is `builds/windows/FactoryPlanner.exe`. Keep the executable, PCK, runtime, kernel, package metadata, and dependency directories together. The packaging script records Node's version and executable hash and copies dependency licenses. It marks the manifest as not ready for release.

For the browser, run `node tools/build_runtime.mjs builds/web`, copy `web/bridge.js` to `builds/web/bridge.js`, then export the `Web` preset to `builds/web/index.html`. Serve that directory over HTTP. The browser bridge handles file selection, portable downloads, and IndexedDB persistence. Expensive work runs in replaceable Workers so cancellation does not require the solver to yield.

Before publishing, the complete dataset, third-party notices, runtime packaging, performance evidence, and remaining product requirements must pass verification. The current development folders are not release packages.

## Checks

Run `npm test`, the extraction Python tests, and `godot --headless --path . --script tools/test_data.gd` after importing with the documented engine. `node tools/verify_kernel_browser.mjs` compares the shared solver and archive reader across Node and Chromium.

After exporting the browser application, run `node tools/verify_app_browser.mjs`. It operates the real canvas controls inside a cross-origin iframe and checks goal creation, group movement, boundary resizing without node movement, portable plan import, undo/redo, malformed-file recovery, download, preferences, and persistence across reload. Optional arguments `<world.zip> <machines.json> <player-catalog.json>` exercise the actual world ZIP through the application's file picker and reconstruction with the real catalog. The fixture remains private.

Rendered captures are saved under `.plans/artifacts/workspace/`. The native `-- --capture --capture-path=<absolute-png-path>` development option calculates the example motor goal and captures the rendered viewport. A Windows export was checked with an empty PATH and isolated APPDATA to establish that it used its bundled runtime. These checks do not establish full StaTech correctness or completed world reconstruction.

Run `godot --headless --path . --script tools/test_goal_editor.gd` to check capacity editing, finite production time, preserved positions, and undo in the application. The optional `-- --catalog=<private-catalog.json>` also checks the captured copper-cluster recipe with advanced upgrades and a sixteen-machine processing array. Rendered runs save editor captures for visual review. A complete pinned capacity setup bypasses enumeration of unrelated loadouts; automatic array optimization still needs broader performance work.

The recipe library displays 150 matches per page and searches the full dataset. Paging limits scene-list allocation for the real catalog; it does not discard recipes. The native real-catalog check covers page navigation and searching by source ID.

Factory settings controls available machines, automatic upgrades, excluded recipes, obtained replication templates, external supply limits and costs, power reserve, infrastructure overhead, and objective weights. Changes apply together and support undo. Enter toggles the selected availability checkbox. Importing a different dataset clears the previous factory settings and remains undoable. Run the engine with --headless --path . --script tools/test_factory_settings.gd for the settings regression check; the browser interaction check also edits reserve and undoes it.

Recipe nodes show readable machine names, exact upgrades per machine, array contents, batch size, and material flow units. The scrollable inspector includes whole-tick capacity, sustained and peak power, startup stock totals, conditions, and source identity. Steam consumption retains fluid units. Long names wrap within nodes and remain available in tooltips. Native checks cover the real macerator, array, and steam machine, plus graph navigation at 1280×720.

Portable plans retain pan, zoom, and the inspected line. Native autosave uses a small `workspace-view.json` alongside the full plan; browser autosave stores the view separately in IndexedDB. View changes are saved after a short pause, without serializing the dataset again. The rendered navigation test checks both portable restoration and a fresh workspace instance. The browser check pans and zooms with pointer input, exports the view, and verifies it after reload.

Desktop calculations use distinct temporary files for each calculation service and remove them after completion, failure, or cancellation. On launch, the application removes abandoned files from its own jobs folder when their owning process is no longer running. Original world archives are never included in this cleanup. Run `tools/test_computation.gd` with the headless engine to check cleanup and concurrent-service isolation.

Factory settings can apply dataset-defined progression presets before individual machine and upgrade overrides. The StaTech presets follow cumulative item tasks in the eight released main quest chapters. Verified ordinary-crafting conversions also unlock machines whose old machine and other ingredients already occur in those chapters; this includes bronze-to-steel upgrades. The selector also offers all supported machines. Quest coverage is a starting point for availability, not proof that every player owns those items. Machines absent from this evidence need an individual override, and obtained replication templates remain a separate choice.

Initial plans arrange recipes into production groups. Within each group, material dependencies run from left to right; recycling cycles share a column. Electrical connections remain visible but do not determine that ordering. Recalculation preserves existing positions and group boundaries, and places newly needed recipes outside occupied areas. Arrange rebuilds the category layout and supports Undo. Select a group and choose Rename group to edit its title.

The imported-factory dialog searches the full machine and recipe lists while displaying 150 entries per page. Changing pages preserves staged corrections; Cancel discards them. Run `tools/test_world_review.gd`, `tools/test_graph_layout.gd`, and `tools/test_groups.gd` with the headless engine for large-list, cyclic-layout, and group-editing regressions.
