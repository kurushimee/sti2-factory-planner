extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45.0).timeout.connect(func() -> void:
		push_error("Exact production interface check timed out.")
		quit(1))
	var arguments := OS.get_cmdline_user_args()
	assert(!arguments.is_empty(), "Supply the checked iron-plate result JSON.")
	var fixture: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(arguments[0]))
	assert(fixture.result.exact_production.status == "exact")
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1440, 900)
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	workspace._request.assign(fixture.request)
	workspace._calculated(fixture.result)
	await workspace.layout_settled
	var plate: PlannerRecipeNode
	for candidate: PlannerRecipeNode in workspace._nodes.values():
		if candidate.recipe_id == fixture.request.goals[0].recipe:
			plate = candidate
			break
	assert(plate != null)
	assert(!"Exact · details" in plate.throughput.text)
	assert("25411/24259" in plate.throughput.tooltip_text)
	assert(workspace._last_result.flow_roundoff.is_empty())
	workspace._select_node(plate)
	assert(workspace.inspector_cards.visible)
	var found_exact := false
	var found_warmup := false
	for child: Node in workspace.inspector_cards.content.get_children():
		if child is HBoxContainer:
			for label: Node in child.get_children():
				found_exact = found_exact || label.tooltip_text.contains("25411/24259")
		if child is Label:
			found_warmup = found_warmup || child.text.contains("Warm-up stock is not calculated")
	assert(found_exact && found_warmup)
	workspace._show_power()
	assert("742082963247/12420608000 EU/t" in workspace.inspector.text)
	workspace._select_node(plate)
	if DisplayServer.get_name() != "headless":
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.plans/artifacts/exact-values"))
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/exact-values/iron-plate-exact-1440.png")
		root.size = Vector2i(1280, 720)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/exact-values/iron-plate-exact-1280.png")
	print("The iron-plate graph and inspector show source-derived exact rates without a flow gap.")
	quit()
