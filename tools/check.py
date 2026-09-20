"""Check repository hygiene before engine and application tests."""

from pathlib import Path
import subprocess
import sys


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    files = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=root
    ).decode().split("\0")
    forbidden = {".jar", ".mca", ".mcr", ".zip", ".exe", ".pck"}
    errors = []
    for name in filter(None, files):
        path = Path(name)
        if path.suffix.lower() in forbidden or path.name == "level.dat":
            errors.append(f"Private input or build artifact is tracked: {name}")
        if path.suffix.lower() in {".gd", ".tscn", ".tres", ".py", ".js", ".mjs", ".json", ".md", ".yml", ".toml"}:
            try:
                path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                errors.append(f"Text file is not UTF-8: {name}")
    for name in ("AGENTS.md", "docs/delivery.md", "project.godot"):
        if not (root / name).is_file():
            errors.append(f"Required project file is missing: {name}")
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("Repository hygiene checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
