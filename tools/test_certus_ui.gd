extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Certus interface check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	await process_frame
	workspace.computation.cancel()
	var recipe: Dictionary = workspace._recipes["certus_growth|clusters"]
	workspace._request = {"goals": [{"recipe": recipe.id, "resource": recipe.primary, "rate": 1.0 / 6.0}],
		"available_machines": ["planner:certus_farm"], "obtained_resources": recipe.requires_obtained,
		"replication": false, "external": [{"resource": "energy:eu"}]}
	workspace._recalculate()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.lines[0].machines == 2)
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.recipe_id == recipe.id:
			workspace._select_node(node)
	assert("Silk Touch I" in workspace.inspector.text)
	assert("Flawless budding quartz" in workspace.inspector.text)
	assert("Exact expected capacity: 1/6 operations/s" in workspace.inspector.text)
	assert("long-run expected rate" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/plan.png")
		workspace.inspector.get_v_scroll_bar().value = workspace.inspector.get_v_scroll_bar().max_value
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/certus/assumptions.png")
	print("Certus goals show whole farms, retained sites and enchanted planes, and expected-rate conditions.")
	quit()
