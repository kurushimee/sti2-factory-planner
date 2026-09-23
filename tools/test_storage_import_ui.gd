extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _sample_world() -> Dictionary:
	var report: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string("res://data/provenance/storage-world-report.json"))
	var machines: Array = []
	var storage: Array = []
	for entry: Dictionary in report.machines:
		var origin: Dictionary = entry.origin
		var key: String = "%s|%d|%d|%d" % [origin.dimension, origin.x, origin.y, origin.z]
		machines.append({"id": entry.machine, "origin": origin, "facts": {"storedEu": entry.saved_charge_eu}})
		storage.append({"machine": key, "machine_id": entry.machine, "origin": origin,
			"enabled": true, "saved_charge_eu": entry.saved_charge_eu, "capacity_eu": entry.capacity_eu,
			"charge_eu_per_tick": entry.charge_eu_per_tick,
			"discharge_eu_per_tick": entry.discharge_eu_per_tick,
			"assumption": "Saved charge is a starting quantity, not a sustained power supply."})
	return {"machines": machines, "providers": [], "unsupported": [], "errors": [],
		"reconstruction": {"goals": [], "storage_units": storage, "unresolved": []}}


func _run() -> void:
	create_timer(90).timeout.connect(func() -> void: push_error("Storage import interface check timed out."); quit(1))
	var small: bool = "--small" in OS.get_cmdline_user_args()
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1280, 720) if small else Vector2i(1440, 900)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	workspace.computation.failed.connect(func(message: String) -> void: push_error(message); quit(1))
	await process_frame
	workspace.computation.cancel()
	var world := ""
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--world="):
			world = argument.trim_prefix("--world=")
	if world.is_empty():
		workspace._job_kind = "import_world"
		workspace._calculated(_sample_world())
	else:
		workspace._import_world(world)
		await workspace.computation.completed
	workspace.get_node("%Notice").hide()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	assert(workspace._request.goals.is_empty())
	assert(workspace._request.periodic_storage.size() == 5)
	assert(workspace._nodes.size() == 5)
	assert(workspace._last_result.get("periodic_power", {}).is_empty())
	var lv := "modern_industrialization:lv_storage_unit"
	assert(workspace._request.periodic_storage_installed[lv] == 1)
	var storage_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.get_meta("storage_unit", {}).get("machine") == lv:
			storage_node = node
	assert(storage_node != null)
	workspace._select_node(storage_node)
	assert("World snapshot" in workspace.inspector.text)
	assert("1066666 EU" in workspace.inspector.text)
	assert("400, 160, 0" in workspace.inspector.text)
	assert("No generation or production goal" in workspace.inspector.text)
	var snapshot: Dictionary = workspace._snapshot()
	assert(PlannerDatasetValidation.check_plan(snapshot).is_empty())
	if DisplayServer.get_name() != "headless":
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.plans/artifacts/workspace"))
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-storage-graph-1280.png" if small else "res://.plans/artifacts/workspace/imported-storage-graph.png")
	var settings := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	settings.open_settings(workspace._dataset, workspace._request, workspace._world_import)
	(settings.get_node("%SettingsCategory") as OptionButton).select(8)
	settings._category_changed(8)
	settings._filter("lv_storage_unit")
	var row: TreeItem = (settings.get_node("%SettingsEntries") as Tree).get_root().get_first_child()
	row.select(0)
	settings._entry_selected()
	await create_timer(0.05).timeout
	assert(settings.size.y <= 710, "Storage dialog stayed too tall: %s" % settings.size)
	assert(settings.get_node("%StorageInstalledEnabled").button_pressed)
	assert(settings.get_node("%StorageInstalled").value == 1)
	assert("1066666 EU saved" in settings.get_node("%StorageImported").text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-storage-settings-1280.png" if small else "res://.plans/artifacts/workspace/imported-storage-settings.png")
	settings.hide()
	var review := workspace.get_node("%WorldReview") as PlannerWorldReview
	await review.open_review(workspace._world_import, workspace._dataset)
	assert(review.get_node("%RetainOutput").button_pressed)
	assert(review.get_node("%RetainOutput").text == "Include this storage in the power plan")
	review._retain_changed(false)
	assert(review._corrections["minecraft:overworld|400|160|0"].storage_enabled == false)
	review.hide()
	workspace._correct_world(review._corrections)
	await workspace.computation.completed
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.periodic_storage.size() == 4)
	assert(workspace._nodes.size() == 4)
	assert(workspace._world_import.reconstruction.storage_units[0].enabled == false)
	workspace._undo_action()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.periodic_storage.size() == 5)
	assert(workspace._nodes.size() == 5)
	var panel := "extended_industrialization:lv_solar_panel"
	workspace._request.periodic_storage = [lv]
	workspace._request.periodic_storage_installed = {lv: 1}
	workspace._request.available_machines = [panel, lv]
	workspace._request.goals = [{"resource": "energy:eu", "rate": 280}]
	workspace._request.external = [{"resource": "item:extended_industrialization:lv_photovoltaic_cell"}]
	workspace._request.time_limit_ms = 30000
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.periodic_power.storage[0].machines == 1)
	assert(workspace._nodes.size() == 2)
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.get_meta("storage_unit", {}).get("machine") == lv:
			workspace._select_node(node)
	assert("1066666 EU total charge" in workspace.inspector.text)
	assert("planned initial charge" in workspace.inspector.text)
	print("Five saved storage units entered editable settings and graph nodes; the LV unit joined a solar plan as initial stock.")
	quit()
