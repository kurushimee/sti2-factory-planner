extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Waste collection check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var path := ""
	for argument: String in OS.get_cmdline_user_args():
		if argument.begins_with("--catalog="): path = argument.trim_prefix("--catalog=")
	assert(!path.is_empty())
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string(path))))
	workspace._request = {"goals": [{"resource": "fluid:extended_industrialization:manure", "recipe": "waste_collection|extended_industrialization:electric_waste_collector", "rate": 2000.0 / 15}], "available_machines": ["extended_industrialization:electric_waste_collector"], "external": [{"resource": "energy:eu"}]}
	workspace._positions.clear()
	workspace._groups.clear()
	workspace._pending_view.clear()
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.lines[0].machines == 1)
	assert("Live farm animal above a waste collector" in workspace.inspector.text)
	assert("Extra animals do not increase output" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await process_frame
		workspace.inspector.get_v_scroll_bar().value = 260
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/waste-collector.png")
	print("Waste collection displays its measured capacity and retained live-animal requirement.")
	quit()
