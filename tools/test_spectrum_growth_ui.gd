extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Spectrum growth interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the verified Spectrum growth request and result.")
	var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._request.assign(fixture.request)
	workspace._calculated(fixture.result)
	await workspace.layout_settled
	assert(workspace._nodes.values().filter(func(candidate: PlannerRecipeNode) -> bool: return !candidate.has_meta("flow_endpoint")).size() == 2)
	var farm: PlannerRecipeNode
	for candidate: PlannerRecipeNode in workspace._nodes.values():
		if candidate.title == "Grow Pure Iron with Iron Nugget":
			farm = candidate
	assert(farm != null)
	assert(farm.input_ports.has("item:minecraft:raw_iron"))
	assert(farm.input_ports.has("item:minecraft:iron_nugget"))
	assert(farm.input_ports.has("ink:spectrum:brown"))
	assert(farm.output_ports.has("item:spectrum:pure_iron"))
	workspace._select_node(farm)
	workspace.graph.scroll_offset = Vector2.ZERO
	await process_frame
	assert(workspace.inspector_cards.visible)
	var card_text := _visible_text(workspace.inspector_cards.content)
	assert("three to five" in card_text)
	assert("40 ticks" in card_text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-growth-plan.png")
	print("The replicatorless Spectrum farm shows its input flows, machine, and estimated yield.")
	quit()


func _visible_text(node: Node) -> String:
	var output: String = node.text + "\n" if node is Label else ""
	for child: Node in node.get_children():
		output += _visible_text(child)
	return output
