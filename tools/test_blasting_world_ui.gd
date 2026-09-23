extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void:
		push_error("Blast-furnace review timed out.")
		quit(1)
	)
	var arguments := OS.get_cmdline_user_args()
	assert(arguments.size() == 1,
		"Supply the private imported-world result from verify_blasting_world.mjs.")
	var source := FileAccess.open(arguments[0], FileAccess.READ)
	assert(source != null)
	var world: Dictionary = PlannerJson.parse(source.get_as_text())
	source.close()
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	var dialog := workspace.get_node("%WorldReview") as PlannerWorldReview
	await dialog.open_review(world, workspace._dataset)
	assert(dialog.get_node("%WorldMachines").item_count == 4)
	assert(dialog.get_node("%WorldRecipes").item_count == 32)
	var indices := {}
	for index: int in world.machines.size():
		indices[int(world.machines[index].origin.x)] = index
	dialog._select_machine(indices[600])
	assert("queued fuel: 1 × minecraft:coal" in dialog.get_node("%WorldDetails").text)
	assert("does not measure a long-term output rate" in dialog.get_node("%WorldDetails").text)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(
			"res://.plans/artifacts/blasting-import/active-furnace.png")
	dialog._select_machine(indices[612])
	assert("queued fuel: empty" in dialog.get_node("%WorldDetails").text)
	assert("Choose a supported fuel route" in dialog.get_node("%WorldDetails").text)
	assert(dialog.get_node("%WorldRecipes").get_item_text(0).begins_with("Saved-input match"))
	assert(dialog.get_node("%WorldRecipes").get_item_text(1).begins_with("Saved-input match"))
	assert(!dialog.get_node("%WorldRecipes").get_item_text(2).begins_with("Saved-input match"))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/blasting-import/choose-fuel.png")
	dialog._select_recipe(0)
	assert(dialog._corrections.has("minecraft:overworld|612|160|0"))
	dialog._select_machine(indices[608])
	assert("past crafts" in dialog.get_node("%WorldDetails").text)
	assert("No active input is saved" in dialog.get_node("%WorldDetails").text)
	dialog.hide()
	print("The loaded blast-furnace review kept saved facts separate from capacity and "
		+ "offered focused fuel corrections.")
	quit()
