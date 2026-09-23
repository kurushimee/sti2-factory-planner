extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(20.0).timeout.connect(func() -> void:
		push_error("Exact capacity interface check timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	await process_frame
	var line := {"recipe": "press", "configuration": "press:batch", "machine": "press", "machines": 2,
		"inputs": [], "outputs": [{"resource": "part", "rate": 0.5}],
		"capacity_per_second": 40.0 / 53.0,
		"capacity_per_second_exact": {"numerator": "40", "denominator": "53", "display": "40/53"},
		"utilization": 0.5 / (40.0 / 53.0), "power_eu_per_tick": 0.0,
		"configuration_details": {"capacity": {"ticks_per_batch": 106}, "setup": {"batch": 2}}}
	var recipe := {"id": "press", "primary": "part", "name": "Precision Press",
		"inputs": [], "outputs": []}
	var resources: Dictionary[String, String] = {"part": "Part", "item:press": "Precision Press"}
	workspace.inspector.text = PlannerDisplay.inspection(line, recipe, resources, {})
	assert("Full-speed capacity: 40/53 operations/s" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		var capture_path := "res://.plans/artifacts/exact-values/"
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(capture_path + "exact-capacity-1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(capture_path + "exact-capacity-1280.png")
	print("Exact installed capacity appears in the inspector.")
	quit()
