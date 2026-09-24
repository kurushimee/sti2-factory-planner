extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Recipe preference interface check timed out."); quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the real recipe preference request and result.")
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
	var selected: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id.ends_with("casing/craft/steel_plated_bricks"):
			selected = node
	assert(selected != null)
	workspace._select_node(selected)
	workspace.graph.scroll_offset = selected.position_offset - Vector2(70, 70)
	await process_frame
	assert(workspace.inspector_cards.visible)
	var card_text := _visible_text(workspace.inspector_cards.content)
	assert("Route choice" in card_text)
	assert("Ordinary crafting uses the same materials for the same outputs." in card_text)
	assert("equal-material route preferences are applied" in PlannerDisplay.optimization_report(fixture.result))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/recipe-preference.png")
	print("The real preferred crafting route and its reason appear in the selected-node inspector.")
	quit()


func _visible_text(node: Node) -> String:
	var output: String = node.text + "\n" if node is Label else ""
	for child: Node in node.get_children():
		output += _visible_text(child)
	return output
