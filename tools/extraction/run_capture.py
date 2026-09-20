"""Capture a prepared isolated server and stop it after extraction."""

import argparse
from pathlib import Path
import subprocess
import time


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instance", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=240)
    parser.add_argument("--fixture", action="store_true", help="Create the controlled import fixture in the isolated test world.")
    parser.add_argument("--structure-fixture", action="store_true", help="Create and check the isolated multiblock structure fixture.")
    args = parser.parse_args()
    instance = args.instance.resolve()
    argument_file = instance / "libraries/net/neoforged/neoforge/21.1.250/win_args.txt"
    if not argument_file.is_file():
        raise SystemExit("Install the pinned NeoForge server before running the capture.")
    if not (instance / "mods/planner-probe.jar").is_file():
        raise SystemExit("Build and install the planner probe before running the capture.")
    log_path = instance / "planner-capture.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(args.jdk / "bin/java.exe"), "-Xmx6G", "@" + str(argument_file), "nogui"],
            cwd=instance, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True,
        )
        deadline = time.monotonic() + args.timeout
        sent = False
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Server capture timed out. Inspect {log_path}.")
                text = log_path.read_text(encoding="utf-8", errors="replace")
                if not sent and "Dedicated server took" in text:
                    commands = ["planner_export", "planner_probe"]
                    if args.fixture:
                        commands.extend(line.strip() for line in (Path(__file__).parent / "fixture-commands.txt").read_text().splitlines() if line.strip())
                    if args.structure_fixture:
                        commands.extend(["forceload add 48 -16 80 16", "tick freeze", "planner_fixture_structure", "save-all flush"])
                    commands.append("stop")
                    process.stdin.write("\n".join(commands) + "\n")
                    process.stdin.flush()
                    sent = True
                time.sleep(0.25)
            text = log_path.read_text(encoding="utf-8", errors="replace")
            if process.returncode != 0 or "PLANNER_EXPORT_COMPLETE" not in text or "PLANNER_PROBE_COMPLETE" not in text:
                raise RuntimeError(f"Capture did not finish successfully. Inspect {log_path}.")
            if args.fixture and "Planner AE2 fixture created." not in text:
                raise RuntimeError(f"Fixture creation did not finish successfully. Inspect {log_path}.")
            if args.structure_fixture and "Planner structure fixture matched:" not in text:
                raise RuntimeError(f"Structure fixture did not match. Inspect {log_path}.")
        finally:
            if process.poll() is None:
                try:
                    process.stdin.write("stop\n")
                    process.stdin.flush()
                    process.wait(timeout=30)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    process.terminate()
                    process.wait(timeout=30)
    print(instance / "planner-extraction")


if __name__ == "__main__":
    main()
