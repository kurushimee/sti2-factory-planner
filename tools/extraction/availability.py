"""Record removed and development-only machines from the released pack."""

REMOVED_MACHINES = {
    "extended_industrialization:bronze_bending_machine": "UNUSED_EI",
    "extended_industrialization:steel_bending_machine": "UNUSED_EI",
    "modern_industrialization:supercomputer": "UNUSED_DEV",
    "modern_industrialization:telescope": "UNUSED_DEV",
}
SOURCE = "kubejs/server_scripts/hidefromEMI.js"
SOURCE_SHA256 = "be2b31bbffcb165dd7df0223f8c98c729f0d636417570f46df9b78322a8f8026"


def annotate_availability(machines, recipes):
    normal_outputs = {flow["resource"] for recipe in recipes if not recipe.get("replication")
                      for flow in recipe["outputs"]}
    result = []
    for machine in machines:
        group = REMOVED_MACHINES.get(machine["id"])
        if group:
            if "item:" + machine["id"] in normal_outputs:
                raise ValueError("The removed-machine evidence needs review: " + machine["id"])
            machine = {**machine, "availability": {
                "automatic": False,
                "reason": "The released pack hides this unused machine and provides no ordinary production recipe. Enable it only if you already have it.",
                "source": {"file": SOURCE, "sha256": SOURCE_SHA256, "group": group},
            }}
        result.append(machine)
    return result
