extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(120.0).timeout.connect(func() -> void:
		push_error("MI goal workflow timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var stage: Dictionary = workspace._dataset.progression[2]
	workspace._request = {"goals": [], "replication": false,
		"available_machines": stage.available_machines.duplicate(),
		"available_upgrades": stage.available_upgrades.duplicate(),
		"external": [{"resource": "item:minecraft:iron_ingot", "cost": 0},
			{"resource": "energy:eu", "cost": 0}]}
	workspace._filter_recipes("materials/iron/compressor/main")
	var selected: PackedInt32Array = workspace.recipes_list.get_selected_items()
	assert(selected.size() == 1)
	var recipe_id: String = workspace.recipes_list.get_item_metadata(selected[0])
	assert(recipe_id == ("modern_industrialization:compressor|"
		+ "modern_industrialization:materials/iron/compressor/main"))
	(workspace.get_node("%Rate") as SpinBox).value = 1
	(workspace.get_node("%AddGoal") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("status") in ["optimal", "feasible"])
	assert(workspace._last_result.lines.size() == 1)
	assert(workspace._last_result.lines[0].recipe == recipe_id)
	assert(workspace._last_result.external.any(func(flow: Dictionary) -> bool:
		return flow.resource == "item:minecraft:iron_ingot" && flow.rate > 0))
	workspace._request.external.remove_at(0)
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("status") in ["optimal", "feasible"])
	assert(workspace._last_result.lines.size() > 10)
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool:
		return "quarry" in line.recipe))
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool:
		return line.recipe == recipe_id))
	if DisplayServer.get_name() != "headless":
		var initial_path := "res://.plans/artifacts/mi-core/initial-iron-plate-"
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(initial_path + "1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(initial_path + "1280.png")
	var ingot_line: Dictionary = {}
	var ingot_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if "dust_to_ingot" in node.recipe_id:
			ingot_line = node.allocation
			ingot_node = node
			break
	assert(ingot_node != null)
	var goals_before: Array = workspace._request.goals.duplicate(true)
	workspace._select_node(ingot_node)
	assert((workspace.get_node("%EditGoal") as Button).text == "Configure production line")
	(workspace.get_node("%EditGoal") as Button).pressed.emit()
	var editor := workspace.get_node("%GoalEditor") as PlannerGoalEditor
	await workspace.computation.completed
	assert(!editor.get_ok_button().disabled)
	assert(editor.get_node("%LineExplanation").visible)
	var upgrades := editor.get_node("%GoalUpgrade") as OptionButton
	for index: int in upgrades.item_count:
		if upgrades.get_item_metadata(index).get("id") == "modern_industrialization:basic_upgrade":
			upgrades.select(index)
			break
	assert(upgrades.selected > 0)
	(editor.get_node("%GoalUpgradeCount") as SpinBox).value = 1
	editor._changed()
	await workspace.computation.completed
	assert(!editor.get_ok_button().disabled)
	var chosen_config: String = editor._preview.configuration.id
	assert(chosen_config != ingot_line.configuration)
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		assert(editor.position.y >= 0)
		assert(editor.position.y + editor.size.y <= root.size.y)
		assert(editor.get_ok_button().get_global_rect().end.y <= editor.size.y)
		root.get_texture().get_image().save_png(
			"res://.plans/artifacts/mi-core/intermediate-choice-1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		assert(editor.position.y >= 0)
		assert(editor.position.y + editor.size.y <= root.size.y)
		assert(editor.get_ok_button().get_global_rect().end.y <= editor.size.y)
		root.get_texture().get_image().save_png(
			"res://.plans/artifacts/mi-core/intermediate-choice-1280.png")
	editor.confirmed.emit()
	editor.hide()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("status") in ["optimal", "feasible"])
	assert(workspace._request.goals == goals_before)
	assert(workspace._request.routes["item:minecraft:iron_ingot"] == ingot_line.recipe)
	assert(workspace._request.configurations[ingot_line.recipe] == chosen_config)
	var goal_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == recipe_id:
			goal_node = node
			break
	assert(goal_node != null)
	var goal_key: String = goal_node.get_meta("position_key")
	goal_node.position_offset = Vector2(1000, 1000)
	workspace._save_positions()
	workspace._filter_recipes("iron_ingot_from_smelting_raw_iron")
	selected = workspace.recipes_list.get_selected_items()
	assert(selected.size() == 1)
	var alternative: String = workspace.recipes_list.get_item_metadata(selected[0])
	assert(alternative != ingot_line.recipe)
	(workspace.get_node("%PinRoute") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("status") in ["optimal", "feasible"])
	assert(workspace._request.goals == goals_before)
	assert(workspace._request.routes["item:minecraft:iron_ingot"] == alternative)
	assert(workspace._positions[goal_key] == [1000.0, 1000.0])
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool:
		return line.recipe == alternative))
	assert((workspace.get_node("%PinRoute") as Button).text == "Clear route")
	(workspace.get_node("%PinRoute") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(!workspace._request.routes.has("item:minecraft:iron_ingot"))
	assert(workspace._request.goals == goals_before)
	assert((workspace.get_node("%PinRoute") as Button).text == "Pin route")
	(workspace.get_node("%Undo") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.routes["item:minecraft:iron_ingot"] == alternative)
	assert(workspace._request.goals == goals_before)
	if DisplayServer.get_name() != "headless":
		var path := "res://.plans/artifacts/mi-core/"
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(path + "iron-plate-1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(path + "iron-plate-1280.png")
	print("MI goal produces a connected material plan from the selected recipe.")
	quit()
