extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(90).timeout.connect(func() -> void: push_error("Solar capacity interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the checked solar capacity result JSON.")
	var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
	assert(fixture.result.status == "feasible")
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1440, 900)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._request.assign(fixture.request)
	workspace._calculated(fixture.result)
	await workspace.layout_settled
	assert(workspace._nodes.size() == 4)
	workspace._show_power()
	assert("Exact periodic capacity needed a bounded solver retry" in workspace.inspector.text)
	assert("numerical roundoff bound" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.plans/artifacts/solar-capacity"))
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/solar-capacity/power-report.png")
		workspace.inspector.scroll_to_line(40)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/solar-capacity/power-report-roundoff.png")
	print("The exact solar capacity plan and its numerical limit are visible in Power details.")
	quit()
