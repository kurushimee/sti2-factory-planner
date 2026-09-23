extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(30).timeout.connect(func() -> void: push_error("World review timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var dialog := workspace.get_node("%WorldReview") as PlannerWorldReview
	var machines: Array[Dictionary] = []
	var recipes: Array[Dictionary] = []
	for index: int in 401:
		machines.append({"id": "test:replicator", "origin": {"dimension": "minecraft:overworld", "x": index, "y": 64, "z": 10}, "recipe_type": "replication", "recipe_id": "recipe:11000", "assignment_evidence": "saved_template", "upgrades": {"id": "test:turbo_upgrade", "count": 4}})
	for index: int in 11257:
		recipes.append({"id": "recipe:%d" % index, "name": "Replicate item %d" % index, "process": {"type": "replication"}})
	var world := {"machines": machines}
	var dataset := {"recipes": recipes}
	await dialog.open_review(world, dataset)
	assert(dialog.get_node("%WorldMachines").item_count == 150)
	assert(dialog.get_node("%WorldRecipes").item_count == 150)
	assert(dialog._recipe_page == 73)
	assert(dialog.get_node("%WorldRecipes").get_item_metadata(dialog.get_node("%WorldRecipes").get_selected_items()[0]) == "recipe:11000")
	dialog.get_node("%MachineNext").pressed.emit()
	dialog.get_node("%WorldMachines").item_selected.emit(5)
	assert(dialog._selected == 155)
	dialog._filter_recipes("11001")
	assert(dialog.get_node("%WorldRecipes").item_count == 1)
	dialog._select_recipe(0)
	dialog._retain_changed(false)
	assert(dialog._corrections["minecraft:overworld|155|64|10"] == {"recipe": "recipe:11001", "goal": false})
	dialog._filter_recipes("")
	dialog.get_node("%RecipeNext").pressed.emit()
	assert(dialog.get_node("%WorldRecipes").get_item_metadata(0) == "recipe:150")
	dialog._filter_machines("|155|")
	assert(dialog.get_node("%WorldMachines").item_count == 1)
	assert(dialog.get_node("%WorldMachines").get_item_metadata(0) == 155)
	dialog._filter_machines("missing")
	assert(dialog.get_node("%WorldMachines").item_count == 0)
	assert(dialog.get_node("%MachineNext").disabled)
	dialog.hide()
	await dialog.open_review(world, dataset)
	assert(dialog._corrections.is_empty())
	assert(!world.has("corrections"))
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/world-review-paging.png")
	dialog.hide()
	await dialog.open_review({"machines": []}, dataset)
	assert(dialog.get_node("%WorldRecipes").item_count == 0)
	assert(dialog.get_node("%RetainOutput").disabled)
	var origin := {"dimension": "minecraft:overworld", "x": 256, "y": 100, "z": 0}
	var key := "minecraft:overworld|256|100|0"
	var tower := {"id": "extended_industrialization:tesla_tower", "origin": origin}
	var selection := {"id": "world:" + key, "machine": tower.id, "variant": "0", "count": 1, "energy_hatch": "modern_industrialization:lv_energy_input_hatch", "transmit_eu_per_tick": 1536, "imported_hatches": [{}, {}, {}, {}, {}, {}, {}], "transmission_basis": "Winding capacity target, not a saved operating rate. Support hatches may be resized."}
	var candidate := {"machine": key, "enabled": true, "configuration": selection, "assumption": "Continuous enabled operation with supplied power; no observed transmission rate or verified receiver network."}
	await dialog.open_review({"machines": [tower], "reconstruction": {"infrastructure": [selection], "infrastructure_candidates": [candidate]}}, dataset)
	assert(dialog.get_node("%WorldRecipes").item_count == 0)
	assert(dialog.get_node("%RetainOutput").button_pressed)
	assert("Saved input hatches: 7" in dialog.get_node("%WorldDetails").text)
	dialog._retain_changed(false)
	assert(dialog._corrections[key] == {"infrastructure_enabled": false})
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/world-review-tesla.png")
	dialog.hide()
	var storage_origin := {"dimension": "minecraft:overworld", "x": 404, "y": 160, "z": 0}
	var storage_key := "minecraft:overworld|404|160|0"
	var storage_machine := {"id": "modern_industrialization:lv_storage_unit", "origin": storage_origin, "facts": {"storedEu": "1066666"}}
	var storage_rule := {"id": storage_machine.id, "mechanic": "energy_storage"}
	var storage_selection := {"machine": storage_key, "saved_charge_eu": "1066666", "capacity_eu": 3200000,
		"charge_eu_per_tick": 256, "assumption": "Cable layout may limit transfer."}
	await dialog.open_review({"machines": [storage_machine], "reconstruction": {"storage_units": [storage_selection]}},
		{"machines": [storage_rule], "recipes": recipes})
	assert(dialog.get_node("%WorldRecipes").item_count == 0)
	assert(!dialog.get_node("%WorldRecipeSearch").editable)
	assert(dialog.get_node("%RetainOutput").disabled)
	assert("Saved charge: 1066666 / 3.2 M EU" in dialog.get_node("%WorldDetails").text)
	assert("not a sustained power supply" in dialog.get_node("%WorldDetails").text)
	dialog._retain_changed(true)
	assert(!dialog._corrections.has(storage_key))
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/world-review-storage.png")
	dialog.hide()
	print("World review passed large lists, page selection, search, staged corrections, cancellation, and empty imports.")
	quit()
