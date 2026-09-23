extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(90.0).timeout.connect(func() -> void:
		push_error("MI graph check timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	assert(workspace._request.get("production_only", false))
	assert(workspace._request.external == [{"resource": "energy:eu", "cost": 0}])
	var stage: Dictionary = workspace._dataset.progression[2]
	assert(workspace._request.available_machines == stage.available_machines)
	workspace._request = {"goals": [], "replication": false,
		"available_machines": stage.available_machines.duplicate(),
		"available_upgrades": stage.available_upgrades.duplicate(),
		"external": [{"resource": "energy:eu", "cost": 0}]}
	workspace._filter_recipes("materials/iron/compressor/main")
	(workspace.get_node("%Rate") as SpinBox).value = 1
	(workspace.get_node("%AddGoal") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("status") in ["optimal", "feasible"])
	assert(workspace._last_result.lines.size() > 60)
	assert((workspace.get_node("%ConnectionMode") as OptionButton).selected == 2)
	var goal: PlannerRecipeNode
	var ingot: PlannerRecipeNode
	var chance_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if "materials/iron/compressor/main" in node.recipe_id:
			goal = node
		if "dust_to_ingot" in node.recipe_id && "iron" in node.recipe_id:
			ingot = node
		if workspace._recipes.has(node.recipe_id) && workspace._recipes[node.recipe_id].get("outputs", []).any(func(output: Dictionary) -> bool:
			return output.get("probability", 1) != 1):
			chance_node = node
	assert(goal != null && ingot != null)
	assert(chance_node != null && "expected yields" in chance_node.throughput.text)
	assert(absf(goal.position_offset.y - ingot.position_offset.y) < goal.size.y)
	assert(workspace._last_result.connections.any(func(connection: Dictionary) -> bool:
		return (connection.source == ingot.get_meta("position_key") &&
			connection.destination == goal.get_meta("position_key"))))
	var graph := workspace.graph
	var focused_count := graph.get_connection_list().size()
	assert(focused_count > 0)
	var count_text := "/%d flows shown" % workspace._graph_connections.size()
	assert((workspace.get_node("%Hint") as Label).text.contains(count_text))
	(workspace.get_node("%ConnectionMode") as OptionButton).select(0)
	workspace._refresh_connections()
	assert(graph.get_connection_list().size() > focused_count)
	assert(workspace._graph_link_errors.is_empty())
	assert(graph.get_connection_list().size() == workspace._graph_connections.size())
	var nodes_by_key: Dictionary = {}
	for node: PlannerRecipeNode in workspace._nodes.values():
		nodes_by_key[node.get_meta("position_key")] = node
	var endpoint_count := 0
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.has_meta("flow_endpoint"):
			endpoint_count += 1
	assert(endpoint_count > 0)
	assert(nodes_by_key.has("goal:" + str(workspace._request.goals[0].resource)))
	for flow: Dictionary in workspace._graph_connections:
		assert(nodes_by_key.has(flow.source) && nodes_by_key.has(flow.destination))
		var producer: PlannerRecipeNode = nodes_by_key[flow.source]
		var consumer: PlannerRecipeNode = nodes_by_key[flow.destination]
		assert(producer.output_ports.has(flow.resource))
		assert(consumer.input_ports.has(flow.resource))
		var matching_link := false
		for link: Dictionary in graph.get_connection_list():
			if link.from_node == producer.name && link.to_node == consumer.name:
				matching_link = matching_link || (link.from_port == producer.output_ports[flow.resource] &&
					link.to_port == consumer.input_ports[flow.resource])
		assert(matching_link)
	if DisplayServer.get_name() != "headless":
		var all_output := "res://.plans/artifacts/mi-graph/"
		assert(DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(all_output)) == OK)
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(all_output + "all-flows-1280.png")
		(workspace.get_node("%ConnectionMode") as OptionButton).select(1)
		workspace._refresh_connections()
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(all_output + "material-flows-1280.png")
	(workspace.get_node("%ConnectionMode") as OptionButton).select(2)
	workspace._refresh_connections()
	workspace._select_node(ingot)
	(workspace.get_node("%FocusRecipe") as Button).pressed.emit()
	var view := Rect2(Vector2.ZERO, graph.size)
	var ingot_center := (ingot.position_offset + ingot.size / 2.0) * graph.zoom - graph.scroll_offset
	assert(view.has_point(ingot_center))
	var visible_supplier := false
	for connection: Dictionary in workspace._last_result.connections:
		if connection.destination != ingot.get_meta("position_key") || connection.resource == "energy:eu":
			continue
		for node: PlannerRecipeNode in workspace._nodes.values():
			if node.get_meta("position_key") == connection.source:
				var center := (node.position_offset + node.size / 2.0) * graph.zoom - graph.scroll_offset
				visible_supplier = visible_supplier || view.has_point(center)
	assert(visible_supplier)
	workspace._select_node(goal)
	(workspace.get_node("%FocusRecipe") as Button).pressed.emit()
	if DisplayServer.get_name() != "headless":
		var output := "res://.plans/artifacts/mi-graph/"
		assert(DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output)) == OK)
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "direct-mi-1440.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "direct-mi-1280.png")
		workspace._select_node(chance_node)
		(workspace.get_node("%FocusRecipe") as Button).pressed.emit()
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(output + "expected-yield-1280.png")
	print("The large MI goal and its immediate supplier share a readable focused view.")
	quit()
