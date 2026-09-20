"""Compile the development probe against the installed reference server."""

import argparse
from pathlib import Path
import subprocess
import zipfile
import os


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instance", type=Path, required=True)
    parser.add_argument("--jdk", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    classes = args.work / "classes"
    classes.mkdir(exist_ok=True)
    libraries = list((args.instance / "libraries").rglob("*.jar"))
    libraries += list((args.instance / "mods").glob("*.jar"))
    classpath = os.pathsep.join(p.as_posix() for p in libraries)
    source = Path(__file__).parent / "java/PlannerProbe.java"
    argfile = args.work / "javac.args"
    argfile.write_text(
        f'-proc:none\n--release\n21\n-classpath\n"{classpath}"\n-d\n"{classes.as_posix()}"\n"{source.resolve().as_posix()}"\n',
        encoding="utf-8",
    )
    subprocess.run([str(args.jdk / "bin/javac.exe"), "@" + str(argfile)], check=True)
    output = args.work / "planner-probe.jar"
    with zipfile.ZipFile(output, "w") as archive:
        for path in classes.rglob("*.class"):
            archive.write(path, path.relative_to(classes).as_posix())
        archive.writestr("META-INF/neoforge.mods.toml", '''modLoader="javafml"
loaderVersion="[4,)"
license="MIT"
[[mods]]
modId="planner_probe"
version="1.0.0"
displayName="Factory Planner Extraction Probe"
''')
    print(output)


if __name__ == "__main__":
    main()
