extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _sample_world() -> Dictionary:
	var report: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string("res://data/provenance/solar-world-report.json"))
	var machines: Array = []
	var panels: Array = []
	var candidates: Array = []
	for entry: Dictionary in report.panels:
		var origin: Dictionary = entry.origin
		var key: String = "%s|%d|%d|%d" % [origin.dimension, origin.x, origin.y, origin.z]
		var fluid: Dictionary = {"resource": "fluid:extended_industrialization:distilled_water", "amount_mb": entry.saved_water_mb}
		var cell: Dictionary = {"resource": "item:" + str(entry.cell), "amount": entry.saved_cell_count}
		machines.append({"id": entry.machine, "origin": origin, "recipe_id": null, "recipe_type": "planner:solar_generation",
			"facts": {"items": [{"key": {"id": entry.cell}, "amount": entry.saved_cell_count}],
				"fluids": [{"key": {"id": "extended_industrialization:distilled_water"}, "amount": entry.saved_water_mb}]}})
		var routes: Array = [str(entry.recipe).replace("|water", "|dry"), entry.recipe]
		var assumption := "Continuous clear weather, open sky, a supplied replacement cell, and a free power output are planning assumptions. Saved cell and water are stocks, not recurring supplies."
		panels.append({"machine": key, "machine_id": entry.machine, "origin": origin, "enabled": true,
			"recipe": entry.recipe, "configuration": entry.recipe, "saved_cell": cell, "saved_fluid": fluid,
			"assumption": assumption, "route_evidence": "saved_water_stock"})
		candidates.append({"machine": key, "machine_id": entry.machine, "origin": origin, "enabled": true,
			"route_candidates": routes, "saved_cell": cell, "saved_fluid": fluid, "assumption": assumption})
	return {"machines": machines, "providers": [], "unsupported": [], "errors": [],
		"reconstruction": {"goals": [], "solar_panels": panels, "solar_candidates": candidates, "unresolved": []}}


func _run() -> void:
	create_timer(90).timeout.connect(func() -> void: push_error("Solar world interface check timed out."); quit(1))
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
	var panel_ids := ["extended_industrialization:lv_solar_panel", "extended_industrialization:mv_solar_panel", "extended_industrialization:hv_solar_panel"]
	workspace._request = {"goals": [], "available_machines": panel_ids.duplicate(), "time_limit_ms": 30000,
		"external": [{"resource": "item:extended_industrialization:lv_photovoltaic_cell"},
			{"resource": "item:extended_industrialization:mv_photovoltaic_cell"},
			{"resource": "item:extended_industrialization:hv_photovoltaic_cell"},
			{"resource": "fluid:extended_industrialization:distilled_water"}]}
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
	assert(workspace._request.installed.size() == 3)
	assert(workspace._request.periodic_storage == ["modern_industrialization:mv_storage_unit"])
	assert(workspace._world_import.reconstruction.solar_panels.size() == 3)
	assert(workspace._last_result.lines.filter(func(line: Dictionary) -> bool: return str(line.recipe).begins_with("planner:solar|")).size() == 3)
	assert(workspace._nodes.size() >= 3)
	var lv_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == "planner:solar|extended_industrialization:lv_solar_panel|water":
			lv_node = node
	assert(lv_node != null)
	workspace._select_node(lv_node)
	assert(workspace.get_node("%EditGoal").text == "Edit power source")
	assert("World snapshot" in workspace.inspector.text)
	assert("400, 250, 0" in workspace.inspector.text)
	assert("9 mB fluid" in workspace.inspector.text)
	var snapshot: Dictionary = workspace._snapshot()
	assert(PlannerDatasetValidation.check_plan(snapshot).is_empty())
	workspace._edit_goal()
	assert(workspace.get_node("%FactorySettings").visible)
	assert((workspace.get_node("%FactorySettings").get_node("%SettingsCategory") as OptionButton).selected == 9)
	workspace.get_node("%FactorySettings").hide()
	if DisplayServer.get_name() != "headless":
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.plans/artifacts/workspace"))
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-solar-graph-1280.png" if small else "res://.plans/artifacts/workspace/imported-solar-graph.png")
	var settings := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	settings.open_settings(workspace._dataset, workspace._request, workspace._world_import)
	(settings.get_node("%SettingsCategory") as OptionButton).select(9)
	settings._category_changed(9)
	settings._filter("lv_solar_panel")
	var rows := settings.get_node("%SettingsEntries") as Tree
	var row: TreeItem = rows.get_root().get_first_child()
	while row && row.get_metadata(0) != "planner:solar|extended_industrialization:lv_solar_panel|water":
		row = row.get_next()
	assert(row != null)
	row.select(0)
	settings._entry_selected()
	assert(settings.get_node("%PowerSourceCount").value == 1)
	assert("1 saved panel" in settings.get_node("%PowerSourceImported").text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-solar-settings-1280.png" if small else "res://.plans/artifacts/workspace/imported-solar-settings.png")
	(settings.get_node("%PowerSourceCount") as SpinBox).value = 2
	settings._apply()
	settings.hide()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.installed["planner:solar|extended_industrialization:lv_solar_panel|water"] == 2)
	workspace._undo_action()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.installed["planner:solar|extended_industrialization:lv_solar_panel|water"] == 1)
	var review := workspace.get_node("%WorldReview") as PlannerWorldReview
	await review.open_review(workspace._world_import, workspace._dataset)
	assert(review.get_node("%RetainOutput").text == "Include this panel in the power plan")
	assert(review.get_node("%RetainOutput").button_pressed)
	assert("9 mB" in review.get_node("%WorldDetails").text)
	assert(review._recipe_matches.size() == 2)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/imported-solar-review-1280.png" if small else "res://.plans/artifacts/workspace/imported-solar-review.png")
	review.hide()
	lv_node = null
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == "planner:solar|extended_industrialization:lv_solar_panel|water":
			lv_node = node
	assert(lv_node != null)
	var old_key := "planner:solar|extended_industrialization:lv_solar_panel|water|planner:solar|extended_industrialization:lv_solar_panel|water"
	var manual_position: Vector2 = lv_node.position_offset + Vector2(27, 18)
	lv_node.position_offset = manual_position
	workspace._positions[old_key] = [manual_position.x, manual_position.y]
	review._corrections["minecraft:overworld|400|250|0"] = {"solar_recipe": "planner:solar|extended_industrialization:lv_solar_panel|dry"}
	workspace._correct_world(review._corrections)
	await workspace.computation.completed
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.installed.has("planner:solar|extended_industrialization:lv_solar_panel|dry"))
	assert(!workspace._request.installed.has("planner:solar|extended_industrialization:lv_solar_panel|water"))
	var new_key := "planner:solar|extended_industrialization:lv_solar_panel|dry|planner:solar|extended_industrialization:lv_solar_panel|dry"
	assert(workspace._positions[new_key] == [manual_position.x, manual_position.y])
	workspace._undo_action()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.installed.has("planner:solar|extended_industrialization:lv_solar_panel|water"))
	print("Three saved solar panels entered the power graph with reviewable routes and stock facts.")
	quit()
