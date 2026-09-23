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
    parser.add_argument("--rotation-fixture", action="store_true", help="Create and check four rotated steam quarries in the isolated test world.")
    parser.add_argument("--solar-panel", action="store_true", help="Measure the three loaded solar panel tiers in the isolated test world.")
    parser.add_argument("--storage-fixture", action="store_true", help="Place five charged MI storage units in the isolated test world.")
    parser.add_argument("--structure-bill", action="store_true", help="Check the prepared structural bill in the isolated world.")
    parser.add_argument("--certus-farm", action="store_true", help="Build and measure both certus farms in the isolated world.")
    args = parser.parse_args()
    if args.solar_panel and args.storage_fixture:
        parser.error("Run the solar measurement and frozen storage fixture in separate captures.")
    instance = args.instance.resolve()
    argument_file = instance / "libraries/net/neoforged/neoforge/21.1.250/win_args.txt"
    if not argument_file.is_file():
        raise SystemExit("Install the pinned NeoForge server before running the capture.")
    if not (instance / "mods/planner-probe.jar").is_file():
        raise SystemExit("Build and install the planner probe before running the capture.")
    log_path = instance / "planner-capture.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(args.jdk / "bin/java.exe"), "-Xmx6G", "-Dplanner.certusFarm=" + str(args.certus_farm).lower(), "@" + str(argument_file), "nogui"],
            cwd=instance, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True,
        )
        deadline = time.monotonic() + args.timeout
        sent = False
        solar_captured_at = None
        solar_roof_sent = False
        prepared_at = None
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Server capture timed out. Inspect {log_path}.")
                text = log_path.read_text(encoding="utf-8", errors="replace")
                if not sent and "Dedicated server took" in text:
                    if args.certus_farm and prepared_at is None:
                        process.stdin.write("forceload add 48 -16 80 16\n")
                        process.stdin.flush()
                        prepared_at = time.monotonic()
                    if args.certus_farm and time.monotonic() - prepared_at < 2:
                        time.sleep(0.25)
                        continue
                    commands = ["planner_export", "planner_probe"]
                    if args.structure_bill:
                        commands.append("planner_check_structure_bill")
                    if args.fixture:
                        commands.extend(line.strip() for line in (Path(__file__).parent / "fixture-commands.txt").read_text().splitlines() if line.strip())
                    if args.structure_fixture:
                        commands.extend(["forceload add 48 -16 80 16", "tick freeze", "planner_fixture_structure", "save-all flush"])
                    if args.rotation_fixture:
                        commands.extend(["forceload add 240 -16 368 16", "tick freeze", "planner_fixture_rotation", "save-all flush"])
                    if args.storage_fixture:
                        commands.extend(["forceload add 400 -16 432 16", "tick freeze", "planner_fixture_storage", "save-all flush"])
                    if args.solar_panel:
                        commands.extend(["forceload add 384 -16 432 16", "planner_probe_solar", "save-all flush"])
                    if not args.solar_panel:
                        commands.append("stop")
                    process.stdin.write("\n".join(commands) + "\n")
                    process.stdin.flush()
                    sent = True
                if args.solar_panel and sent and not solar_roof_sent and "Planner solar panel samples captured from three loaded machines." in text:
                    if solar_captured_at is None:
                        solar_captured_at = time.monotonic()
                    if time.monotonic() - solar_captured_at >= 2:
                        process.stdin.write("planner_probe_solar_roof\nsave-all flush\nstop\n")
                        process.stdin.flush()
                        solar_roof_sent = True
                time.sleep(0.25)
            text = log_path.read_text(encoding="utf-8", errors="replace")
            if process.returncode != 0 or "PLANNER_EXPORT_COMPLETE" not in text or "PLANNER_PROBE_COMPLETE" not in text:
                raise RuntimeError(f"Capture did not finish successfully. Inspect {log_path}.")
            if args.fixture and "Planner AE2 fixture created." not in text:
                raise RuntimeError(f"Fixture creation did not finish successfully. Inspect {log_path}.")
            if args.structure_bill and "Planner structural bill matched the loaded world structure." not in text:
                raise RuntimeError(f"The structural bill did not match. Inspect {log_path}.")
            if args.structure_fixture and "Planner structure fixture matched:" not in text:
                raise RuntimeError(f"Structure fixture did not match. Inspect {log_path}.")
            if args.rotation_fixture and "Planner rotation fixtures matched all four loaded steam quarries." not in text:
                raise RuntimeError(f"Rotated structure fixtures did not match. Inspect {log_path}.")
            if args.solar_panel and "Planner solar panel samples captured from three loaded machines." not in text:
                raise RuntimeError(f"Solar panel measurement did not finish. Inspect {log_path}.")
            if args.solar_panel and "Planner solar roof samples captured from three loaded machines." not in text:
                raise RuntimeError(f"Solar roof measurement did not finish. Inspect {log_path}.")
            if args.storage_fixture and "Planner storage fixture placed five charged MI storage units." not in text:
                raise RuntimeError(f"Storage fixture did not finish successfully. Inspect {log_path}.")
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
