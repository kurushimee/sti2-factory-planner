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
	assert(workspace._nodes.size() == 1)
	var node: PlannerRecipeNode = workspace._nodes.values()[0]
	assert(node.title == "Brown ink (dye)")
	assert("1 ×" in node.summary.text)
	assert(node.input_ports.has("item:minecraft:brown_dye"))
	assert(node.output_ports.has("ink:spectrum:brown"))
	workspace._select_node(node)
	workspace.graph.scroll_offset = node.position_offset - Vector2(120, 80)
	await process_frame
	assert("20" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-ink-plan.png")
	print("The loaded Color Picker route shows one machine, brown dye input, and brown ink output.")
	quit()
