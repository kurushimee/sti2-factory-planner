extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(120.0).timeout.connect(func() -> void:
		push_error("Processing Unit preview check timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var all: Dictionary = workspace._dataset.progression[-1]
	assert(workspace._request.available_machines == all.available_machines)
	assert(workspace._request.available_upgrades == all.available_upgrades)
	workspace._filter_recipes("processing unit")
	var selected := workspace.recipes_list.get_selected_items()
	assert(!selected.is_empty())
	var route: String = workspace.recipes_list.get_item_metadata(selected[0])
	assert(route == "minecraft:crafting_shaped|modern_industrialization:electric_age/circuit/craft/processing_unit_asbl")
	var rate_input: LineEdit = (workspace.get_node("%Rate") as SpinBox).get_line_edit()
	rate_input.text = "0.2"
	rate_input.text_changed.emit("0.2")
	(workspace.get_node("%AddGoal") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._request.goals[0].rate == 0.2)
	assert(workspace._last_result.get("status") == "feasible")
	assert(workspace._last_result.exact_production.status == "exact")
	assert(workspace._last_result.lines.size() > 150)
	assert(workspace._graph_link_errors.is_empty())
	assert((workspace.get_node("%ConnectionMode") as OptionButton).selected == 1)
	assert(workspace.graph.get_connection_list().size() > 0)
	(workspace.get_node("%ConnectionMode") as OptionButton).select(0)
	workspace._refresh_connections()
	assert(workspace.graph.get_connection_list().size() == workspace._graph_connections.size())
	assert(workspace.graph.zoom_min <= 0.051)
	assert(workspace.inspector_cards.visible)
	var all_rects: Array[Rect2] = []
	for node: PlannerRecipeNode in workspace._nodes.values():
		var rect := Rect2(node.position_offset, node.size)
		for other: Rect2 in all_rects:
			assert(!rect.intersects(other))
		all_rects.append(rect)
		assert(!node.throughput.text.contains("Exact"))
		assert(!node.power.text.contains("details"))
		var center := rect.get_center()
		assert(workspace._groups.values().any(func(group: Dictionary) -> bool:
			var bounds: Array = group.rect
			return Rect2(bounds[0], bounds[1], bounds[2], bounds[3]).has_point(center)))
	var group_rects: Array[Rect2] = []
	for group: Dictionary in workspace._groups.values():
		var bounds: Array = group.rect
		var rect := Rect2(bounds[0], bounds[1], bounds[2], bounds[3])
		for other: Rect2 in group_rects:
			assert(!rect.intersects(other))
		group_rects.append(rect)
	var visible_text := ""
	for child: Node in workspace.inspector_cards.content.get_children():
		if child is Label:
			visible_text += child.text
	assert("Build" in visible_text && "Capacity" in visible_text && "Power" in visible_text)
	if DisplayServer.get_name() != "headless":
		var output := "res://.plans/artifacts/preview-review/"
		assert(DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output)) == OK)
		for size: Vector2i in [Vector2i(1440, 900), Vector2i(1280, 720)]:
			root.size = size
			await create_timer(0.2).timeout
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(output + "processing-unit-%d.png" % size.x)
			(workspace.get_node("%ConnectionMode") as OptionButton).select(1)
			workspace._refresh_connections()
			await RenderingServer.frame_post_draw
			root.get_texture().get_image().save_png(output + "processing-unit-materials-%d.png" % size.x)
			(workspace.get_node("%ConnectionMode") as OptionButton).select(0)
			workspace._refresh_connections()
	var example: Variant = PlannerJson.parse(FileAccess.get_file_as_string("res://data/example.json"))
	assert(workspace._load_dataset(example))
	workspace._request = workspace._new_request()
	assert(workspace._dataset.identity == "example:1")
	(workspace.get_node("%NewPlan") as Button).pressed.emit()
	await workspace.layout_settled
	assert(workspace._dataset.identity == "statech-industry-2:2.0.1")
	assert(workspace._request.goals.is_empty())
	assert(workspace._nodes.is_empty())
	assert(workspace._request.available_machines == all.available_machines)
	(workspace.get_node("%Undo") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._dataset.identity == "example:1")
	print("Fresh Processing Unit, graph, inspector, and in-app reset passed.")
	quit()
