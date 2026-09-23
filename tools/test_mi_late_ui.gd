extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(120.0).timeout.connect(func() -> void:
		push_error("The late MI graph check timed out.")
		quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the verified late MI request and result JSON.")
	var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
	assert(fixture.result.status == "feasible")
	assert(fixture.result.exact_production.status == "exact")
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace.computation._accept({"phase": "catalog_support"})
	assert("Finding the recipes" in workspace.status.text)
	workspace.computation._accept({"phase": "catalog_refinement"})
	assert("full machine" in workspace.status.text)
	workspace._request.assign(fixture.request)
	workspace._calculated(fixture.result)
	await workspace.layout_settled
	assert(workspace._last_result.lines.size() > 400)
	assert(workspace._graph_connections.size() > 1300)
	assert(workspace._graph_link_errors.is_empty())
	var by_key: Dictionary = {}
	for node: PlannerRecipeNode in workspace._nodes.values():
		by_key[node.get_meta("position_key")] = node
	var all_mode: OptionButton = workspace.get_node("%ConnectionMode")
	all_mode.select(0)
	workspace._refresh_connections()
	assert(workspace.graph.get_connection_list().size() == workspace._graph_connections.size())
	for flow: Dictionary in workspace._graph_connections:
		assert(by_key.has(flow.source) && by_key.has(flow.destination))
		var producer: PlannerRecipeNode = by_key[flow.source]
		var consumer: PlannerRecipeNode = by_key[flow.destination]
		assert(producer.output_ports.has(flow.resource))
		assert(consumer.input_ports.has(flow.resource))
	var goal: PlannerRecipeNode
	var certus: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == fixture.request.goals[0].recipe:
			goal = node
		if node.recipe_id.begins_with("certus_growth|"):
			certus = node
	assert(goal != null && certus != null)
	workspace._select_node(certus)
	assert("expected yields" in certus.throughput.text)
	assert("Exact expected capacity" in workspace.inspector.text)
	assert("Actual deliveries vary" in workspace.inspector.text)
	all_mode.select(2)
	workspace._refresh_connections()
	workspace._select_node(goal)
	(workspace.get_node("%FocusRecipe") as Button).pressed.emit()
	if DisplayServer.get_name() != "headless":
		var output := "res://.plans/artifacts/mi-late/"
		assert(DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output)) == OK)
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "quantum-goal-1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "quantum-goal-1280.png")
		workspace._select_node(certus)
		(workspace.get_node("%FocusRecipe") as Button).pressed.emit()
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "certus-source-1280.png")
	workspace._show_power()
	assert("complete machine choices" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/mi-late/plan-details-1280.png")
	print("The late MI plan has every logical flow connected to a visible graph endpoint.")
	quit()
