extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Color Picker interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the verified Color Picker request and result.")
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
	var recipe_nodes := workspace._nodes.values().filter(func(candidate: PlannerRecipeNode) -> bool: return !candidate.has_meta("flow_endpoint"))
	assert(recipe_nodes.size() == 1)
	var node: PlannerRecipeNode = recipe_nodes[0]
	assert(node.title == "Brown ink (dye)")
	assert("1 ×" in node.summary.text)
	assert(node.input_ports.has("item:minecraft:brown_dye"))
	assert(node.output_ports.has("ink:spectrum:brown"))
	workspace._select_node(node)
	workspace.graph.scroll_offset = node.position_offset - Vector2(120, 80)
	await process_frame
	assert(workspace.inspector_cards.visible)
	assert("20" in _visible_text(workspace.inspector_cards.content))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-ink-plan.png")
	print("The loaded Color Picker route shows one machine, brown dye input, and brown ink output.")
	quit()


func _visible_text(node: Node) -> String:
	var output: String = node.text + "\n" if node is Label else ""
	for child: Node in node.get_children():
		output += _visible_text(child)
	return output
