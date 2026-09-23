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
	workspace.computation._accept({"phase": "reading_regions", "completed": 3, "total": 12})
	assert(workspace.status.text == "Reading world regions · 3 of 12…")
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/world-import-progress.png")
	workspace.computation._accept({"phase": "production_routes", "attempt": 3})
	assert(workspace.status.text == "Balancing production routes · attempt 3…")
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/endgame-route-progress.png")
	workspace.computation._accept({"phase": "construction_verification"})
	assert(workspace.status.text == "Checking the new plan's full construction cost…")
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/endgame-progress.png")
	workspace.computation._accept({"phase": "route_choices"})
	assert(workspace.status.text == "Comparing alternative production routes…")
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/alternative-route-progress.png")
	workspace._request.assign(fixture.request)
	var started := Time.get_ticks_msec()
	workspace._calculated(fixture.result)
	print("Synchronous result application took %d ms." % (Time.get_ticks_msec() - started))
	await workspace.layout_settled
	assert(workspace._nodes.size() == fixture.result.lines.size())
	assert(workspace.get_node("%ConnectionMode").selected == 2)
	var focused_count := workspace.graph.get_connection_list().size()
	assert(focused_count > 0 && focused_count < 20)
	workspace.get_node("%ConnectionMode").select(0)
	workspace._refresh_connections()
	assert(workspace.graph.get_connection_list().size() > 400)
	workspace.get_node("%ConnectionMode").select(1)
	workspace._refresh_connections()
	var material_count := workspace.graph.get_connection_list().size()
	assert(material_count > focused_count)
	workspace.get_node("%ConnectionMode").select(2)
	workspace._refresh_connections()
	assert("Feasible plan" in workspace.status.text)
	var saved: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string("user://autosave.json"))
	assert(saved.request.goals[0].rate == fixture.request.goals[0].rate)
	assert(!saved.has("dataset") && saved.dataset_ref.length() == 64)
	assert(FileAccess.get_file_as_bytes("user://autosave.json").size() < 500000)
	var save_started := Time.get_ticks_msec()
	workspace._autosave()
	print("Saving the full workspace without rewriting its dataset took %d ms." % (Time.get_ticks_msec() - save_started))
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
	if fixture.result.optimization.get("lower_bound") != null:
		assert("Proven cost bound" in workspace.inspector.text)
	else:
		assert("no global cost bound" in workspace.inspector.text)
	assert("Net generation" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/endgame-details.png")
	var previous_count := workspace._nodes.size()
	workspace._calculated({"status": "limit", "optimal": false})
	assert(workspace._nodes.size() == previous_count)
	workspace._calculated({"status": "numerical_error", "optimal": false, "reason": "The output flow is smaller than the verified calculation precision."})
	assert(workspace._nodes.size() == previous_count)
	assert("precision could not be verified" in workspace.status.text)
	assert("output flow" in workspace.get_node("%Notice").dialog_text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/numerical-failure.png")
	print("The complete feasible graph, cost bound, power report, and failed-calculation recovery pass.")
	quit()
