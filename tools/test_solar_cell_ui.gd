extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(90).timeout.connect(func() -> void: push_error("Solar cell correction check timed out."); quit(1))
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1280, 720)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	workspace.computation.failed.connect(func(message: String) -> void: push_error(message); quit(1))
	await process_frame
	workspace.computation.cancel()
	var mismatch := "--mismatch" in OS.get_cmdline_user_args()
	var panel := "extended_industrialization:lv_solar_panel"
	var cell := "item:extended_industrialization:lv_photovoltaic_cell"
	var water := "fluid:extended_industrialization:distilled_water"
	var route := "planner:solar|extended_industrialization:lv_solar_panel|water"
	var origin := {"dimension": "minecraft:overworld", "x": 400, "y": 250, "z": 0}
	var key := "minecraft:overworld|400|250|0"
	var expected_supplies := [{"resource": cell}, {"resource": water}]
	workspace._request = {"goals": [], "available_machines": [panel], "external": expected_supplies.duplicate(true), "time_limit_ms": 30000}
	var other_item: Variant = {"resource": "item:minecraft:stick", "amount": "2"} if mismatch else null
	var saved := {"id": panel, "origin": origin, "recipe_id": null,
		"facts": {"items": [{"key": {"id": "minecraft:stick"}, "amount": "2"}] if mismatch else [],
			"fluids": [{"key": {"id": water.trim_prefix("fluid:")}, "amount": "9"}]}}
	var candidate := {"machine": key, "machine_id": panel, "origin": origin, "enabled": true,
		"route_candidates": [route.replace("|water", "|dry"), route], "expected_cell": cell,
		"saved_cell": null, "other_saved_item": other_item, "saved_fluid": {"resource": water, "amount_mb": "9"},
		"assumption": "A matching replacement cell needs continuous supply; saved water is only stock."}
	var imported := {"machines": [saved], "providers": [], "unsupported": [], "errors": [],
		"reconstruction": {"goals": [], "solar_panels": [], "solar_candidates": [candidate],
			"unresolved": [{"machine": key, "reason": "No matching photovoltaic cell is saved in this panel."}]}}
	workspace._job_kind = "import_world"
	workspace._calculated(imported)
	workspace.get_node("%Notice").hide()
	assert(workspace._world_import.reconstruction.solar_panels.is_empty())
	var review := workspace.get_node("%WorldReview") as PlannerWorldReview
	await review.open_review(workspace._world_import, workspace._dataset)
	assert(review.get_node("%ConfirmSolarCell").visible)
	assert(!review.get_node("%ConfirmSolarCell").button_pressed)
	assert("Matching cell needed" in review.get_node("%WorldDetails").text)
	assert("No matching photovoltaic cell" in review.get_node("%WorldDetails").text)
	if mismatch:
		assert("Other saved item: 2 × Stick" in review.get_node("%WorldDetails").text)
	if DisplayServer.get_name() != "headless":
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.plans/artifacts/solar-cell"))
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/solar-cell/mismatched-cell-review.png" if mismatch else "res://.plans/artifacts/solar-cell/missing-cell-review.png")
	var confirmation := review.get_node("%ConfirmSolarCell") as CheckButton
	await process_frame
	confirmation.grab_focus()
	await process_frame
	assert(review.gui_get_focus_owner() == confirmation)
	var toggle := InputEventKey.new()
	toggle.keycode = KEY_SPACE
	toggle.pressed = true
	review.push_input(toggle)
	await process_frame
	toggle.pressed = false
	review.push_input(toggle)
	assert(confirmation.button_pressed)
	assert(review._corrections[key].solar_cell_confirmed)
	var next := InputEventKey.new()
	next.keycode = KEY_TAB
	next.pressed = true
	review.push_input(next)
	await process_frame
	assert(review.gui_get_focus_owner() == review.get_ok_button())
	review.hide()
	workspace._correct_world(review._corrections)
	await workspace.computation.completed
	await workspace.computation.completed
	await workspace.layout_settled
	workspace.get_node("%Notice").hide()
	assert(workspace._world_import.reconstruction.unresolved.is_empty())
	assert(workspace._world_import.reconstruction.solar_panels.size() == 1)
	var planned: Dictionary = workspace._world_import.reconstruction.solar_panels[0]
	assert(planned.recipe == route)
	assert(planned.saved_cell == null)
	assert(planned.other_saved_item == other_item)
	assert(planned.cell_evidence == "player_supply_confirmation")
	assert(planned.origin.dimension == origin.dimension)
	assert(int(planned.origin.x) == origin.x && int(planned.origin.y) == origin.y && int(planned.origin.z) == origin.z)
	assert(workspace._request.external == expected_supplies)
	assert(workspace._request.installed[route] == 1)
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool: return line.recipe == route))
	assert(PlannerDatasetValidation.check_plan(workspace._snapshot()).is_empty())
	var solar_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == route:
			solar_node = node
	assert(solar_node != null)
	workspace._select_node(solar_node)
	assert("no saved cell" in workspace.inspector.text)
	assert("matching cell supply confirmed by player" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/solar-cell/confirmed-panel-graph.png")
		workspace.inspector.scroll_to_line(34)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/solar-cell/confirmed-panel-inspector.png")
	print("A missing saved cell required explicit confirmation and kept its stock and supply facts separate.")
	quit()
