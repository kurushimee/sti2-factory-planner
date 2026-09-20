# Godot tooling

The local Codex configuration is `.codex/config.toml`. It reuses the installed Node-based Godot MCP server at `C:/Users/kurus/.codex/mcp-servers/godot-mcp/build/index.js` and the stock Godot 4.7.2 executable. These absolute paths describe this workstation; update them on another machine. No API key is required. MCP caches stay under the ignored `.godot/mcp-cache/` directory.

## Engine commands

Run from `F:/sti2-factory-planner` in PowerShell:

```powershell
& 'C:/Users/kurus/AppData/Local/Programs/Godot_v4.7.2/Godot_v4.7.2-stable_win64_console.exe' --headless --editor --import --path .
```

This imports assets and refreshes registered script classes. Inspect errors as well as the exit code. It does not prove runtime behavior or appearance. Once the project has a main scene, launch it with the same executable and `--path .`; use `--editor --path .` to open the editor. Use the current GL Compatibility renderer for visual verification.

`gdparse` and `gdlint` are available through the workstation's gdtoolkit installation. Apply them to changed scripts; `gdlintrc` defines the declaration order and line limit. They complement engine checks and do not replace them. There is no test addon installed yet; add an appropriate harness when behavior warrants one, with its actual commands documented here.

## Repository checks

Run `python tools/check.py` and `git diff --check` from the project root. GitHub Actions repeats repository hygiene and a Godot 4.7.2 headless import. These checks do not yet test application behavior. The workstation has matching Windows and single-threaded web templates under `%APPDATA%/Godot/export_templates/4.7.2.stable`. See [browser constraints](web-platform.md) before adding platform-dependent behavior.

## MCP connection

Use the server's advertised tools and schemas. Project-scoped operations need the absolute `projectPath` value `F:/sti2-factory-planner`. Prefer read-only version and project-info calls to check connectivity. Launching the editor or running the project is useful when the task needs it; adding scenes and nodes mutates project files and belongs within the requested change.

Project configuration must be loaded by a trusted Codex session. After changing the configuration, start a new session in this repository if the Godot tools are absent. Check `codex mcp list` or `codex mcp get godot` from this directory to inspect the effective configuration. A direct server handshake confirms the server works; it does not prove the current desktop session has reloaded its tools.

## Instruction maintenance

Keep root rules focused on project facts, skill triggers, and completion criteria. Put detailed procedures in the relevant guide or skill, and read them when the task needs them. Preserve explicit user requirements when shortening instructions. This follows [OpenAI's skills and prompts guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).
