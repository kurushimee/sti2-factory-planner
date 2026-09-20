"""Assign initial workspace groups without changing production rules."""


def production_group(recipe):
    if recipe.get("group"):
        return recipe["group"]
    primary = recipe["primary"]
    process = recipe.get("process", {}).get("type", recipe.get("type", ""))
    if primary == "energy:eu":
        return "Power"
    if any(word in process for word in ("quarry", "drilling", "probe", "greenhouse", "crusher", "pump")):
        return "Extraction"
    if any(word in primary for word in ("circuit", "processor", "transistor", "capacitor", "resistor", "diode")):
        return "Circuits"
    if any(word in primary for word in ("diesel", "gasoline", "naphtha", "coke", "fuel", "bioethanol", "biodiesel")):
        return "Fuels"
    if any(word in process for word in ("macerator", "ore_washer", "centrifuge", "sifter")):
        return "Ore processing"
    if any(word in process for word in ("chemical", "electrolyzer", "distill", "mixer")) or primary.startswith("fluid:"):
        return "Chemicals"
    if any(word in primary for word in ("_ingot", "_plate", "_rod", "_wire", "_block", "_nugget")):
        return "Metals"
    if any(word in process for word in ("assembler", "packer", "crafting")):
        return "Machinery"
    return "Production"
