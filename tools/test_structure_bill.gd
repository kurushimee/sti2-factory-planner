extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(
		func() -> void:
			push_error("Structural bill check timed out.")
			quit(1)
	)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var path := ""
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--catalog="):
			path = argument.trim_prefix("--catalog=")
	assert(!path.is_empty())
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string(path))))
	var recipe: Dictionary = {}
	var irradiation_mode := OS.get_cmdline_user_args().has("--irradiation")
	var irradiation_id := (
		"irradiate|item:modern_industrialization:uranium_fuel_rod"
		+ "|modern_industrialization:beryllium_block"
	)
	for value: Dictionary in workspace._dataset.recipes:
		var irradiation_match: bool = irradiation_mode && value.id == irradiation_id
		var steel_match: bool = (
			!irradiation_mode
			&& value.primary == "item:modern_industrialization:steel_ingot"
			&& value.get("process", {}).get("type") == "modern_industrialization:blast_furnace"
		)
		if irradiation_match || steel_match:
			recipe = value
			break
	assert(!recipe.is_empty())
	var external: Array[Dictionary] = [{"resource": "energy:eu"}]
	for input: Dictionary in recipe.inputs:
		external.append({"resource": input.get("resource", input.get("choices", [""])[0])})
	workspace._request = {
		"goals": [{"resource": recipe.primary, "recipe": recipe.id, "rate": 1}],
		"available_machines": ["modern_industrialization:electric_blast_furnace"],
		"external": external
	}
	if irradiation_mode:
		workspace._request.goals[0].rate = 0.02
		workspace._request.available_machines = [
			"yet_another_industrialization:nuclear_rod_irradiator"
		]
		external.append({"resource": "item:modern_industrialization:beryllium_block"})
	workspace._positions.clear()
	workspace._groups.clear()
	workspace._pending_view.clear()
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	var line: Dictionary = workspace._last_result.lines[0]
	assert(line.configuration_details.structure.status == "sized")
	assert("Build requirements per machine" in workspace.inspector.text)
	assert("Cable throughput does not size the build bill" in workspace.inspector.text)
	assert(
		(
			("Nuclear Item Hatch" if irradiation_mode else "Heatproof Machine Casing").to_lower()
			in workspace.inspector.text.to_lower()
		)
	)
	if DisplayServer.get_name() != "headless":
		await process_frame
		workspace.inspector.get_v_scroll_bar().value = 280
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(
			(
				"res://.plans/artifacts/workspace/irradiation-bill.png"
				if irradiation_mode
				else "res://.plans/artifacts/workspace/structure-bill.png"
			)
		)
		workspace.inspector.get_v_scroll_bar().value = 900
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(
			"res://.plans/artifacts/workspace/hatch-storage-assumptions.png"
		)
	if irradiation_mode:
		assert("initial source discovery" in workspace.inspector.text)
		var settings := workspace.get_node("%FactorySettings") as PlannerFactorySettings
		settings.open_settings(workspace._dataset, workspace._request)
		settings.get_node("%SettingsCategory").select(5)
		settings._category_changed(5)
		settings.get_node("%SettingsSearch").text = "nuclear"
		settings._filter("nuclear")
		var nuclear_hatch_found := false
		for entry: Dictionary in settings._matches:
			if entry.id == "modern_industrialization:nuclear_item_hatch" && !entry.unsupported:
				nuclear_hatch_found = true
		assert(nuclear_hatch_found)
		if DisplayServer.get_name() != "headless":
			await create_timer(0.2).timeout
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(
				"res://.plans/artifacts/workspace/irradiation-hatch-settings.png"
			)
	print("The actual recipe includes its measured structural bill in the plan and inspector.")
	quit()
