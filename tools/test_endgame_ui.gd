extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(90).timeout.connect(func() -> void: push_error("Endgame interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply a saved solver request and result JSON.")
	var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
	assert(fixture.result.status == "feasible")
	assert(fixture.result.lines.size() > 400)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._request.assign(fixture.request)
	var started := Time.get_ticks_msec()
	workspace._calculated(fixture.result)
	await workspace.layout_settled
	assert(workspace._nodes.size() == fixture.result.lines.size())
	assert("Feasible plan" in workspace.status.text)
	var saved: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string("user://autosave.json"))
	assert(saved.request.goals[0].rate == fixture.request.goals[0].rate)
	workspace.graph.zoom = 1.0
	await process_frame
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == fixture.request.goals[0].recipe:
			workspace._select_node(node)
			workspace.graph.scroll_offset = node.position_offset * workspace.graph.zoom - Vector2(50, 50)
	await process_frame
	await process_frame
	assert(PlannerDisplay.number(1.0 / 3600.0) == "2.778e-4")
	print("Endgame graph layout completed in %d ms." % (Time.get_ticks_msec() - started))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/endgame-plan.png")
	workspace._show_power()
	assert("lowest cost has not been proven" in workspace.inspector.text)
	assert("Proven cost bound" in workspace.inspector.text)
	assert("Net generation" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/endgame-details.png")
	var previous_count := workspace._nodes.size()
	workspace._calculated({"status": "limit", "optimal": false})
	assert(workspace._nodes.size() == previous_count)
	print("The complete feasible graph, cost bound, power report, and failed-calculation recovery pass.")
	quit()
