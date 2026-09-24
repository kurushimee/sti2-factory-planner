extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(240).timeout.connect(func() -> void: push_error("Graph arrangement timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var arguments := OS.get_cmdline_user_args()
	if !arguments.is_empty():
		var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
		workspace._request.assign(fixture.request)
		workspace._calculated(fixture.result)
	else:
		workspace._filter_recipes("processing unit")
		(workspace.get_node("%Rate") as SpinBox).value = 0.2
		(workspace.get_node("%AddGoal") as Button).pressed.emit()
		await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.get("exact_production", {}).get("status") == "exact")
	assert(!workspace.graph.routes.is_empty(), workspace.status.text)
	assert(workspace.graph.routes.size() == workspace._graph_connections.size())
	var cards: Dictionary[String, Rect2] = {}
	var bounds := Rect2()
	for node: PlannerRecipeNode in workspace._nodes.values():
		var rect := Rect2(node.position_offset, node.size)
		for other: Rect2 in cards.values():
			assert(!rect.intersects(other), "Overlapping graph cards")
		cards[node.get_meta("position_key")] = rect
		bounds = rect if bounds.size == Vector2.ZERO else bounds.merge(rect)
	var spans: Array[float] = []
	var geometry: Array[Dictionary] = []
	for node: PlannerRecipeNode in workspace._nodes.values():
		var ports: Array[Dictionary] = []
		for resource: String in node.input_ports:
			var point := node.get_input_port_position(node.input_ports[resource])
			ports.append({"side": "WEST", "resource": resource, "x": point.x, "y": point.y})
		for resource: String in node.output_ports:
			var point := node.get_output_port_position(node.output_ports[resource])
			ports.append({"side": "EAST", "resource": resource, "x": point.x, "y": point.y})
		geometry.append({"id": node.get_meta("position_key"), "width": node.size.x,
			"height": node.size.y, "ports": ports})
	for route: Dictionary in workspace.graph.routes:
		if route.resource != "energy:eu":
			spans.append(cards[route.source].get_center().distance_to(cards[route.destination].get_center()))
	spans.sort()
	assert(spans[-1] < maxf(bounds.size.x, bounds.size.y) * 0.55)
	assert(spans[floori(spans.size() * 0.95)] < 5000)
	var mode: OptionButton = workspace.get_node("%ConnectionMode")
	mode.select(0)
	workspace._refresh_connections()
	assert(workspace._graph_link_errors.is_empty())
	assert(workspace.graph.get_connection_list().size() == workspace._graph_connections.size())
	assert(workspace.graph._paths.size() == workspace.graph.routes.size())
	var output := "res://.plans/artifacts/graph-arrangement/"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output))
	var prefix := "large" if !arguments.is_empty() else "processing"
	var snapshot := workspace._snapshot()
	assert(PlannerDatasetValidation.check_plan(snapshot).is_empty())
	var malformed := snapshot.duplicate()
	malformed.graph_routes = [{"source": "bad"}]
	assert(!PlannerDatasetValidation.check_plan(malformed).is_empty())
	var file := FileAccess.open(output + prefix + "-geometry.json", FileAccess.WRITE)
	file.store_string(JSON.stringify({"nodes": geometry, "positions": snapshot.positions,
		"connections": workspace._graph_connections, "routes": snapshot.graph_routes}, "", true, true))
	file.close()
	file = FileAccess.open(output + prefix + "-plan.json", FileAccess.WRITE)
	file.store_string(JSON.stringify(snapshot, "", true, true))
	file.close()
	if DisplayServer.get_name() != "headless":
		for viewport_size: Vector2i in [Vector2i(1440, 900), Vector2i(1280, 720)]:
			root.size = viewport_size
			(workspace.get_node("%ExpandGraph") as Button).button_pressed = true
			await create_timer(0.2).timeout
			workspace._highlight_neighbors("")
			workspace.graph.zoom = minf((workspace.graph.size.x - 60) / bounds.size.x,
				(workspace.graph.size.y - 90) / bounds.size.y)
			workspace.graph.scroll_offset = bounds.get_center() * workspace.graph.zoom - workspace.graph.size / 2
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(output + "%s-all-%d.png" % [prefix, viewport_size.x])
			for node: PlannerRecipeNode in workspace._nodes.values():
				if node.recipe_id == workspace._request.goals[0].get("recipe"):
					workspace._select_node(node)
					break
			workspace._focus_recipe(true)
			assert(workspace.graph.zoom >= 0.7, "Focused cards must remain readable.")
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(output + "%s-chain-%d.png" % [prefix, viewport_size.x])
			var cancel := InputEventAction.new()
			cancel.action = "ui_cancel"
			cancel.pressed = true
			workspace._graph_input(cancel)
			await process_frame
			assert((workspace.get_node("%Library") as Control).visible)
			assert((workspace.get_node("%InspectorPanel") as Control).visible)
	workspace._restore_plan(snapshot)
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace.graph.routes == snapshot.graph_routes)
	for key: String in cards:
		assert(workspace._positions[key] == snapshot.positions[key])
	print("Graph verified: %d nodes, %d routes; median %.0f, p95 %.0f, max %.0f; saved geometry restored." % [
		cards.size(), workspace.graph.routes.size(), spans[spans.size() / 2], spans[floori(spans.size() * 0.95)], spans[-1]])
	quit()
