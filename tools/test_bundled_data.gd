extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Bundled data check timed out."); quit(1))
	var started := Time.get_ticks_msec()
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	assert(workspace._dataset.identity == "statech-industry-2:2.0.1")
	assert(workspace._dataset.recipes.size() >= 28981)
	assert(workspace._dataset.resources.size() >= 12024)
	assert(workspace._recipes.has("waste_collection|extended_industrialization:electric_waste_collector"))
	assert(workspace._recipes.has("spectrum:ink_converting|spectrum:ink_converting/dye/brown"))
	assert(workspace._request.goals.is_empty())
	assert(workspace._dataset.loaded_mods.any(func(mod: Dictionary) -> bool: return mod.id == "modern_industrialization" && mod.version == "2.5.8"))
	workspace.search.text = "creative storage unit"
	workspace._filter_recipes(workspace.search.text)
	assert(workspace.recipes_list.item_count > 0)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/bundled-dataset.png")
	workspace.search.text = "Brown ink"
	workspace._filter_recipes(workspace.search.text)
	assert(workspace.recipes_list.item_count >= 3)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/spectrum-ink-routes.png")
	workspace.get_node("%About").pressed.emit()
	var about := workspace.get_node("%AboutDialog") as PlannerAbout
	await create_timer(0.2).timeout
	assert(about.visible)
	assert("not approved by or associated" in about.get_node("%AboutText").text)
	assert(about.get_node("%AboutSection").item_count >= 15)
	for document: String in about._documents:
		assert(!document.is_empty())
	assert(about.get_viewport().gui_get_focus_owner() == about.get_node("%AboutSection"))
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/about-1440.png")
		root.size = Vector2i(1280, 720)
		about.popup_centered()
		about.get_node("%AboutSection").select(1)
		about._show_document(1)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/about-attribution-1280.png")
	await create_timer(0.2).timeout
	var escape := InputEventKey.new()
	escape.keycode = KEY_ESCAPE
	escape.pressed = true
	Input.parse_input_event(escape)
	await process_frame
	escape.pressed = false
	Input.parse_input_event(escape)
	await create_timer(0.2).timeout
	assert(!about.visible)
	assert(root.gui_get_focus_owner() == workspace.get_node("%About"))
	var arguments := OS.get_cmdline_user_args()
	if !arguments.is_empty():
		var output := FileAccess.open(arguments[0], FileAccess.WRITE)
		assert(output != null)
		output.store_string(JSON.stringify(workspace._dataset, "", true, true))
		output.close()
	print("The bundled StaTech catalog opened without extraction tools in ", Time.get_ticks_msec() - started, " ms.")
	quit()
