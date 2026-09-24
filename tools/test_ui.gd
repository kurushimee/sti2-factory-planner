extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(20.0).timeout.connect(func() -> void: push_error("The UI check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	await process_frame
	assert(root.gui_get_focus_owner() == workspace.get_node("%Search"))
	var key := InputEventKey.new()
	key.keycode = KEY_TAB
	key.pressed = true
	Input.parse_input_event(key)
	await process_frame
	key.pressed = false
	Input.parse_input_event(key)
	assert(root.gui_get_focus_owner() == workspace.get_node("%Recipes"))
	var shoulder := InputEventJoypadButton.new()
	shoulder.button_index = JOY_BUTTON_RIGHT_SHOULDER
	shoulder.pressed = true
	Input.parse_input_event(shoulder)
	await process_frame
	shoulder.pressed = false
	Input.parse_input_event(shoulder)
	assert(root.gui_get_focus_owner() == (workspace.get_node("%Rate") as SpinBox).get_line_edit())
	var feedback := workspace.get_node("%Feedback") as PlannerFeedback
	var capture := AudioEffectCapture.new()
	var bus := AudioServer.get_bus_index("UI")
	assert(bus >= 0)
	AudioServer.add_bus_effect(bus, capture)
	feedback.enabled = true
	feedback.confirm()
	await create_timer(0.2).timeout
	var samples := capture.get_buffer(capture.get_frames_available())
	var peak := 0.0
	for sample: Vector2 in samples:
		peak = maxf(peak, maxf(absf(sample.x), absf(sample.y)))
	assert(peak > 0.001 && peak < 0.1)
	workspace._inspected_key = ""
	workspace._pending_view.clear()
	workspace.graph.zoom = 1.0
	workspace.graph.scroll_offset = Vector2.ZERO
	workspace._request = {"goals": [{"resource": "motor", "rate": 2.0, "recipe": "assemble"}]}
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	workspace.graph.grab_focus()
	var previous := workspace._inspected_key
	var right := InputEventJoypadButton.new()
	right.button_index = JOY_BUTTON_DPAD_RIGHT
	right.pressed = true
	Input.parse_input_event(right)
	await process_frame
	right.pressed = false
	Input.parse_input_event(right)
	assert(workspace._inspected_key != previous)
	var selected := workspace._inspected_key
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._inspected_key == selected)
	if !workspace._recipes.has(workspace._selected):
		for node: PlannerRecipeNode in workspace._nodes.values():
			if workspace._recipes.has(node.recipe_id):
				workspace._select_node(node)
				break
	assert(workspace._recipes.has(workspace._selected))
	selected = workspace._inspected_key
	var confirm := InputEventJoypadButton.new()
	confirm.button_index = JOY_BUTTON_A
	confirm.pressed = true
	Input.parse_input_event(confirm)
	await process_frame
	confirm.pressed = false
	Input.parse_input_event(confirm)
	await process_frame
	assert(workspace.get_node("%GoalEditor").visible)
	await workspace.computation.completed
	var cancel := InputEventJoypadButton.new()
	await process_frame
	await process_frame
	cancel.button_index = JOY_BUTTON_B
	cancel.pressed = true
	Input.parse_input_event(cancel.duplicate())
	if workspace.get_node("%GoalEditor").visible:
		await workspace.get_node("%GoalEditor").visibility_changed
	cancel.pressed = false
	Input.parse_input_event(cancel.duplicate())
	assert(!workspace.get_node("%GoalEditor").visible)
	workspace.graph.grab_focus()
	await process_frame
	cancel.pressed = true
	Input.parse_input_event(cancel.duplicate())
	await process_frame
	cancel.pressed = false
	Input.parse_input_event(cancel.duplicate())
	assert(root.gui_get_focus_owner() == workspace.search)
	var saved_plan_text := FileAccess.get_file_as_string("user://autosave.json")
	workspace.graph.zoom = 0.8
	workspace.graph.scroll_offset = Vector2(100, 200)
	await create_timer(0.7).timeout
	var view: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://workspace-view.json"))
	assert(is_equal_approx(view.view.zoom, 0.8))
	assert(view.view.scroll == [100.0, 200.0])
	assert(FileAccess.get_file_as_string("user://autosave.json") == saved_plan_text)
	var snapshot := workspace._snapshot()
	workspace.graph.zoom = 1.0
	workspace.graph.scroll_offset = Vector2.ZERO
	workspace._restore_plan(snapshot)
	await workspace.computation.completed
	await process_frame
	await process_frame
	assert(is_equal_approx(workspace.graph.zoom, 0.8))
	assert(workspace.graph.scroll_offset.is_equal_approx(Vector2(100, 200)))
	assert(workspace._inspected_key == selected)
	workspace.queue_free()
	await process_frame
	workspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await workspace.computation.completed
	await process_frame
	await process_frame
	assert(is_equal_approx(workspace.graph.zoom, 0.8))
	assert(workspace.graph.scroll_offset.is_equal_approx(Vector2(100, 200)))
	assert(workspace._inspected_key == selected)
	if DisplayServer.get_name() != "headless":
		await create_timer(0.25).timeout
		for node: PlannerRecipeNode in workspace._nodes.values():
			assert(node.size.y < 240)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/graph-navigation.png")
	print("Keyboard and gamepad focus navigation passed. The UI audio bus mixed a quiet confirmation tone with peak ", peak, ".")
	print("Workspace pan, zoom, and inspection survived portable restoration and a fresh workspace instance without rewriting the dataset during navigation.")
	quit()
