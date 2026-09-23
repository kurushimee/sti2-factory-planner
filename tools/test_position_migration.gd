extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _node_for(workspace: PlannerWorkspace, recipe_id: String) -> PlannerRecipeNode:
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == recipe_id:
			return node
	return null


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Position migration timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	workspace.computation.failed.connect(func(message: String) -> void: push_error(message); quit(1))
	await process_frame
	workspace.computation.cancel()
	var dataset: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json"))
	dataset.recipes[0].configurations.append({"id": "rapid_drill", "machine": "Ore drill", "operations_per_second": 4, "eu_per_operation": 20})
	assert(workspace._load_dataset(dataset))
	workspace._request = {"goals": [
		{"kind": "capacity", "recipe": "mine_ore", "resource": "ore", "configuration": "drill", "machines": 1},
		{"recipe": "mine_coal", "resource": "coal", "rate": 1.0}], "external": [{"resource": "energy:eu"}]}
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	await process_frame
	await process_frame
	var ore := _node_for(workspace, "mine_ore")
	var coal := _node_for(workspace, "mine_coal")
	assert(ore != null && coal != null)
	ore.position_offset = Vector2(300, 400)
	coal.position_offset = Vector2(30, 90)
	workspace._groups.clear()
	workspace._groups["manual"] = {"title": "Ore production", "rect": [250.0, 350.0, 520.0, 300.0]}
	workspace._restore_groups()
	await process_frame
	await process_frame
	workspace._save_positions()
	workspace._select_node(ore)
	assert(workspace._members[String(ore.name)] == "manual")
	var coal_position: Array = workspace._positions["mine_coal|coal_drill"].duplicate()
	workspace._remember()
	workspace._request.goals[0].configuration = "rapid_drill"
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	ore = _node_for(workspace, "mine_ore")
	assert(ore != null)
	assert(ore.get_meta("position_key") == "mine_ore|rapid_drill")
	assert(ore.position_offset == Vector2(300, 400))
	assert(workspace._positions["mine_coal|coal_drill"] == coal_position)
	assert(!workspace._positions.has("mine_ore|drill"))
	assert(workspace._members[String(ore.name)] == "manual")
	assert(workspace._inspected_key == "mine_ore|rapid_drill")
	assert(workspace._last_result.targets[0].rate == 4.0)
	if DisplayServer.get_name() != "headless":
		OS.low_processor_usage_mode = false
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/loadout-position.png")
	workspace._undo_action()
	await workspace.computation.completed
	await workspace.layout_settled
	ore = _node_for(workspace, "mine_ore")
	assert(ore.get_meta("position_key") == "mine_ore|drill")
	assert(ore.position_offset == Vector2(300, 400))
	assert(workspace._members[String(ore.name)] == "manual")
	workspace._redo_action()
	await workspace.computation.completed
	await workspace.layout_settled
	ore = _node_for(workspace, "mine_ore")
	assert(ore.get_meta("position_key") == "mine_ore|rapid_drill")
	assert(ore.position_offset == Vector2(300, 400))
	assert(workspace._members[String(ore.name)] == "manual")
	print("Changing a machine loadout preserves the recipe position, group, selection, and Undo/Redo.")
	quit()
