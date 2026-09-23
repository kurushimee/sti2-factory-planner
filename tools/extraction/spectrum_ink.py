"""Adapt loaded Spectrum Color Picker recipes to stored-ink production."""


INK_KINDS = {"dye", "pigment", "pigment_blocks"}


def color_picker_catalog(runtime, measurement):
    samples = measurement.get("color_picker", [])
    if [(value.get("brown_ink"), value.get("dye_remaining")) for value in samples] != [
            (5, 2), (10, 1), (15, 0)]:
        raise ValueError("The loaded Color Picker trial does not match three brown-dye conversions.")

    entries = [entry for entry in runtime["recipes"]
               if entry["recipe"].get("type") == "spectrum:ink_converting"]
    if len(entries) != 48:
        raise ValueError("The loaded Color Picker recipe count changed.")
    resources = {}
    recipes = []
    source_ids = set()
    for entry in entries:
        source_id = entry["id"]
        parts = source_id.split("/")
        raw = entry["recipe"]
        if (len(parts) != 3 or parts[0] != "spectrum:ink_converting"
                or parts[1] not in INK_KINDS or parts[2] not in {
                    "black", "blue", "brown", "cyan", "gray", "green", "light_blue", "light_gray",
                    "lime", "magenta", "orange", "pink", "purple", "red", "white", "yellow"
                }):
            raise ValueError("A loaded ink recipe needs a separate adapter: " + source_id)
        input_item = raw.get("ingredient", {}).get("item")
        color = raw.get("ink_color")
        amount = raw.get("amount")
        if (not input_item or color != "spectrum:" + parts[2]
                or amount != {"dye": 5, "pigment": 100, "pigment_blocks": 900}[parts[1]]):
            raise ValueError("The loaded Color Picker recipe changed: " + source_id)
        if source_id in source_ids:
            raise ValueError("Duplicate loaded Color Picker recipe: " + source_id)
        source_ids.add(source_id)
        output = "ink:" + color
        resources[output] = {"id": output, "name": parts[2].replace("_", " ").title() + " ink",
                             "kind": "ink", "unit": "ink"}
        identity = "spectrum:ink_converting|" + source_id
        recipes.append({
            "id": identity, "source_id": source_id, "origin": "loaded_color_picker_ticks",
            "type": "spectrum:ink_converting",
            "name": resources[output]["name"] + " (" + {
                "dye": "dye", "pigment": "pigment", "pigment_blocks": "block"
            }[parts[1]] + ")",
            "group": "Chemicals", "primary": output,
            "inputs": [{"resource": "item:" + input_item, "amount": 1}],
            "outputs": [{"resource": output, "amount": amount}],
            "configurations": [{
                "id": identity, "machine": "spectrum:color_picker", "operations_per_second": 4,
                "capacity": {"operations_per_second": 4, "ticks_per_batch": 5,
                             "completion_ticks": [5], "warmup_ticks": 0,
                             "eu_per_operation": 0, "peak_eu_per_tick": 0,
                             "average_full_load_eu_per_tick": 0},
                "build_requirements": [{"resource": "item:spectrum:color_picker", "amount": 1}],
                "assumptions": [
                    "One input converts every five game ticks while the Color Picker has room for its ink.",
                    "This route yields stored ink at the Color Picker. Transfer to consumers has not been measured."
                ]
            }]
        })
    if len(resources) != 16 or len(source_ids) != 48:
        raise ValueError("The loaded Color Picker colors or recipes changed.")
    machine = {"id": "spectrum:color_picker", "status": "supported", "mechanic": "fixed_cycle",
               "recipe_type": "spectrum:ink_converting", "operation_ticks": 5,
               "ink_storage_capacity": 16777216,
               "assumptions": ["The fixed-cycle rate comes from the matching Spectrum server tick logic.",
                               "Ink transfer throughput and losses are outside this machine's output rate."]}
    return list(resources.values()), machine, recipes, source_ids
