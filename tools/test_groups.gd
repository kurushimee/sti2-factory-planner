extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(20).timeout.connect(func() -> void: push_error("Group editing timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._groups.clear()
	workspace._positions.clear()
	workspace._request = {"goals": [{"recipe": "mine_ore", "resource": "ore", "rate": 1}]}
	workspace._recalculate()
	await workspace.computation.completed
	await process_frame
	await process_frame
	await process_frame
	var old_keys: Array = workspace._groups.keys()
	workspace._add_group()
	var key: String = workspace._groups.keys().filter(func(value: String) -> bool: return !value in old_keys)[0]
	workspace._select_node(workspace._frames[key])
	workspace._edit_goal()
	await process_frame
	var dialog := workspace.get_node("%GroupNameDialog") as ConfirmationDialog
	var field := workspace.get_node("%GroupName") as LineEdit
	assert(field.has_focus())
	field.text = "Steel and stainless steel"
	field.text_changed.emit(field.text)
	var before: Dictionary = workspace._groups[key].duplicate(true)
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/group-name.png")
	field.text_submitted.emit(field.text)
	assert(workspace._groups[key].title == field.text)
	assert(workspace._groups[key].rect == before.rect)
	assert(!dialog.visible)
	workspace._undo_action()
	await workspace.computation.completed
	assert(workspace._groups[key].title == before.title)
	workspace._redo_action()
	await workspace.computation.completed
	assert(workspace._groups[key].title == "Steel and stainless steel")
	workspace._select_node(workspace._frames[key])
	workspace._edit_goal()
	field.text = "  "
	field.text_changed.emit(field.text)
	assert(dialog.get_ok_button().disabled)
	field.text_submitted.emit(field.text)
	assert(workspace._groups[key].title == "Steel and stainless steel")
	dialog.hide()
	workspace.graph.zoom = 0.73
	var positions: Dictionary = workspace._positions.duplicate(true)
	var groups: Dictionary = workspace._groups.duplicate(true)
	workspace._request.goals.append({"recipe": "assemble", "resource": "motor", "rate": 1})
	workspace._recalculate()
	await workspace.computation.completed
	await process_frame
	await process_frame
	await process_frame
	for position_key: String in positions:
		assert(workspace._positions[position_key] == positions[position_key])
	assert(workspace._groups == groups)
	var nodes: Array = workspace._nodes.values()
	for first: PlannerRecipeNode in nodes:
		for second: PlannerRecipeNode in nodes:
			if first != second:
				assert(!Rect2(first.position_offset, first.size).intersects(Rect2(second.position_offset, second.size)))
	workspace._arrange()
	assert(workspace._groups.size() == 4)
	assert(workspace._members.size() == workspace._nodes.size())
	workspace._undo_action()
	await workspace.computation.completed
	assert(workspace._groups == groups)
	print("Group naming passed focus, submit, undo/redo, empty-name rejection, and boundary preservation.")
	quit()
