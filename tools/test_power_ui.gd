extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(40).timeout.connect(func() -> void: push_error("Power interface check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace._request = {"goals": [{"resource": "motor", "rate": 2}], "overhead_eu_per_tick": 5, "reserve_fraction": 0.1}
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	var power: Dictionary = workspace._last_result.power
	assert(is_equal_approx(power.net_generation_eu_per_tick, 57.0))
	assert(is_equal_approx(power.other_production_consumption_eu_per_tick, 52.0))
	assert(is_equal_approx(power.generation_related_consumption_eu_per_tick, 57.0 / 99.0))
	var summary := workspace.get_node("%Summary") as Button
	summary.grab_focus()
	await process_frame
	var key := InputEventKey.new()
	key.keycode = KEY_ENTER
	key.pressed = true
	root.push_input(key)
	await process_frame
	key.pressed = false
	root.push_input(key)
	await process_frame
	assert("Factory power" in workspace.inspector.text)
	assert("Net generation" in workspace.inspector.text)
	assert("Remaining running margin" in workspace.inspector.text)
	assert(workspace.inspector_cards.visible && workspace.inspector_cards.has_focus())
	assert(workspace.get_node("%EditGoal").disabled)
	if DisplayServer.get_name() != "headless":
		for dimensions: Vector2i in [Vector2i(1440, 900), Vector2i(1280, 720)]:
			root.size = dimensions
			await create_timer(0.2).timeout
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/power-%d.png" % dimensions.x)
		workspace.inspector.get_v_scroll_bar().value = workspace.inspector.get_v_scroll_bar().max_value
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/power-notes.png")
	print("Power details open through keyboard input and separate running demand from installed reserves.")
	quit()
