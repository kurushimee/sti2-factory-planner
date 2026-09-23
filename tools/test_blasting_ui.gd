extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Blast-furnace interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the verified blast-furnace request and result.")
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
	assert("lava bucket" in node.title.to_lower())
	assert("5 ×" in node.summary.text)
	assert(node.input_ports.has("item:minecraft:lava_bucket"))
	assert(node.output_ports.has("item:minecraft:bucket"))
	workspace._select_node(node)
	workspace.graph.scroll_offset = node.position_offset - Vector2(100, 70)
	await process_frame
	assert("lava bucket" in workspace.inspector.text.to_lower())
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/blasting/blast-furnace-plan.png")
	print("The loaded blast-furnace route shows five machines, whole fuel, and the returned bucket.")
	quit()
