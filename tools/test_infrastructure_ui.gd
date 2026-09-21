extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: push_error("Infrastructure interface check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace._request = {"goals": [], "external": [{"resource": "energy:eu"}], "overhead_eu_per_tick": 5, "available_machines": []}
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	dialog.get_node("%SettingsCategory").select(7)
	dialog._category_changed(7)
	var tree := dialog.get_node("%SettingsEntries") as Tree
	var item: TreeItem = tree.get_root().get_first_child()
	assert(item.get_text(0) == "Copper Tesla tower")
	item.select(0)
	await process_frame
	tree.grab_focus()
	await process_frame
	var key := InputEventKey.new()
	key.keycode = KEY_ENTER
	key.pressed = true
	dialog.push_input(key)
	await process_frame
	key.pressed = false
	dialog.push_input(key)
	await process_frame
	var count := dialog.get_node("%InfrastructureCount") as SpinBox
	count.get_line_edit().grab_focus()
	await process_frame
	count.value = 2
	await process_frame
	assert(dialog._request.infrastructure.size() == 1)
	assert(dialog._request.infrastructure[0].count == 2)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/infrastructure-settings.png")
		root.size = Vector2i(1280, 720)
		dialog.popup_centered()
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/infrastructure-settings-1280.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.power.infrastructure.total_eu_per_tick == 133)
	assert(workspace._last_result.power.external_eu_per_tick == 133)
	workspace._show_power()
	assert("Copper Tesla tower" in workspace.inspector.text)
	assert("transfer limit per machine" in workspace.inspector.text)
	if DisplayServer.get_name() != "headless":
		await process_frame
		workspace.inspector.get_v_scroll_bar().value = 390
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/infrastructure-power.png")
	workspace._undo_action()
	await workspace.computation.completed
	assert(workspace._last_result.power.external_eu_per_tick == 5)
	workspace._redo_action()
	await workspace.computation.completed
	assert(workspace._last_result.power.external_eu_per_tick == 133)
	print("Loaded Tesla infrastructure accepts keyboard selection, count changes, Undo/Redo, and measured power accounting.")
	quit()
