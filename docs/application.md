# Application development

The current workspace is a development application using `data/example.json`, a fictional dataset. It is not the requested StaTech release. Issues #3 and #5 through #8 track the remaining dataset, planning, editing, reconstruction, and verification work.

Open the project with stock Godot 4.7.2 and run `ui/workspace.tscn`. Development desktop calculations use Node 24 and the installed npm dependencies. Released Windows packages include their own Node executable. Browser calculations run in single-threaded Workers; the Godot export also has thread support disabled.

The interface uses charcoal surfaces, copper focus accents, teal material flows, and Inter typography. The font is distributed under the included SIL Open Font License in `ui/fonts/OFL.txt`; its source is Google Fonts' `ofl/inter` directory. `tools/build_theme.py` generates the shared theme. The original SVG mark represents connected production nodes. Motion is limited to a short graph update fade, with a reduced-motion control.

Interface sounds are quiet and opt-in. `tools/build_ui_audio.py` generates the original tones, which play through the authored UI audio bus. Sound and reduced-motion preferences are saved with the plan. Tab and gamepad shoulder buttons follow the main focus order; the import review has its own focus loop. `tools/test_ui.gd` checks keyboard and shoulder-button navigation and measures a mixed confirmation tone. The heuristic UI audit misses the audio players inside the instanced Node scene; the resource and mixer checks establish that they are connected.

The Imported factory dialog shows machine origins, saved upgrades, recipe evidence, and compatible recipe choices. Applying corrections recalculates inferred capacity goals and preserves unresolved entries. The real-catalog browser check also covers undo across dataset changes and removing the final imported goal. The production-goal editor supports rate, finite quantity, and whole-machine capacity targets. It previews supported machines, upgrades, batches, array contents, and structure variants before applying a change. Existing imported goals retain their world origins. Unlock controls and large-catalog performance still need work.

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
