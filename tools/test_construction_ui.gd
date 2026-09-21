extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(40).timeout.connect(func() -> void: push_error("Construction UI check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.default_dataset_path = "res://data/construction-example.json"
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace._request = {"goals": [{"recipe": "production", "resource": "product", "rate": 1}], "external": [{"resource": "ore"}]}
	workspace._recalculate()
	await workspace.computation.completed
	await process_frame
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	dialog.get_node("%SettingsCategory").select(6)
	dialog._category_changed(6)
	dialog.get_node("%SettingsSearch").text = "ore"
	dialog._filter("ore")
	var entries := dialog.get_node("%SettingsEntries") as Tree
	entries.get_root().get_first_child().select(0)
	await process_frame
	entries.grab_focus()
	await process_frame
	var key := InputEventKey.new()
	key.keycode = KEY_ENTER
	key.pressed = true
	dialog.push_input(key)
	await process_frame
	key.pressed = false
	dialog.push_input(key)
	await process_frame
	assert(dialog._construction.external.size() == 1)
	dialog.get_node("%ConstructionEnabled").grab_focus()
	key.pressed = true
	dialog.push_input(key)
	await process_frame
	key.pressed = false
	dialog.push_input(key)
	await process_frame
	assert(dialog.get_node("%ConstructionEnabled").button_pressed)
	dialog.get_node("%ConstructionWeight").value = 2.5
	dialog.get_node("%SupplyUnlimited").button_pressed = false
	dialog.get_node("%SupplyLimit").value = 6
	dialog.get_node("%SupplyCost").value = 2
	assert(dialog._request.external == [{"resource": "ore"}])
	assert(!workspace._request.has("construction"))
	if DisplayServer.get_name() != "headless":
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/construction-settings-1440.png")
		root.size = Vector2i(1280, 720)
		dialog.popup_centered()
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/construction-settings-1280.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.construction.external[0].quantity == 6)
	assert(!workspace._request.construction.external[0].has("limit"))
	assert(workspace._request.construction.weight == 2.5)
	assert(workspace._last_result.construction.material_cost == 12)
	assert(workspace._last_result.construction.requirements[0].amount == 2)
	assert(workspace._last_result.external[0].rate == 1)
	assert("Factory construction estimate" in workspace.inspector.text)
	assert("Unrounded material equivalents" in workspace.inspector.text)
	var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://autosave.json"))
	assert(saved.request.construction.external[0].quantity == 6)
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		workspace.inspector.scroll_to_line(18)
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/construction-inspector.png")
	workspace._undo_action()
	await workspace.computation.completed
	await process_frame
	assert(!workspace._request.has("construction"))
	workspace._redo_action()
	await workspace.computation.completed
	assert(workspace._last_result.construction.material_cost == 12)
	print("Construction settings passed keyboard editing, separate quantities, calculation, persistence, Undo, and Redo.")
	quit()
