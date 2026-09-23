extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Spectrum growth interface check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace._filter_recipes("Grow Pure Iron with Iron Nugget")
	assert(workspace.recipes_list.item_count == 1)
	assert("Grow Pure Iron with Iron Nugget" in workspace.recipes_list.get_item_text(0))
	assert("no source-derived cycle time" in workspace.recipes_list.get_item_tooltip(0))
	assert(workspace.get_node("%RecipeAvailability").visible)
	assert("Capacity unavailable" in workspace.get_node("%RecipeAvailability").text)
	assert(workspace._nodes.is_empty())
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-growth-unavailable.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-growth-unavailable-1280.png")
	workspace._add_goal()
	await workspace.computation.failed
	assert("no source-derived cycle time" in workspace.status.text)
	assert(workspace._nodes.is_empty())
	print("Spectrum growth remains visible but cannot enter an exact factory plan without a derived farm cycle.")
	quit()
