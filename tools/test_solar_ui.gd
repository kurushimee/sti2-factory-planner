extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(45).timeout.connect(func() -> void: push_error("Solar interface check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	var panel := "extended_industrialization:lv_solar_panel"
	var storage := "modern_industrialization:lv_storage_unit"
	var cell := "item:extended_industrialization:lv_photovoltaic_cell"
	workspace._request = {"goals": [{"resource": "energy:eu", "rate": 280}],
		"available_machines": [panel], "external": [{"resource": cell}]}
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	await process_frame
	var category := dialog.get_node("%SettingsCategory") as OptionButton
	category.select(8)
	dialog._category_changed(8)
	dialog._filter("lv_storage_unit")
	var entries := dialog.get_node("%SettingsEntries") as Tree
	var item := entries.get_root().get_first_child()
	assert(item && item.get_metadata(0) == storage && !item.is_checked(0))
	item.select(0)
	entries.grab_focus()
	await process_frame
	await process_frame
	assert(dialog.gui_get_focus_owner() == entries)
	var toggle := InputEventKey.new()
	toggle.keycode = KEY_ENTER
	toggle.pressed = true
	dialog.push_input(toggle)
	await process_frame
	toggle.pressed = false
	dialog.push_input(toggle)
	await process_frame
	assert(storage in dialog._request.periodic_storage)
	var limit_enabled := dialog.get_node("%StorageLimitEnabled") as CheckButton
	limit_enabled.button_pressed = true
	(dialog.get_node("%StorageLimit") as SpinBox).value = 1
	assert(dialog._request.periodic_storage_limits[storage] == 1)
	if DisplayServer.get_name() != "headless":
		root.size = Vector2i(1440, 900)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/solar-storage-settings.png")
		root.size = Vector2i(1280, 720)
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/solar-storage-settings-1280.png")
		root.size = Vector2i(1440, 900)
	dialog._apply()
	dialog.hide()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.periodic_power.storage[0].machines == 1)
	assert(workspace._last_result.startup.energy_storage_initial_charge_eu > 0)
	var generation_cycle: Dictionary = workspace._last_result.periodic_power.generation[0].cell_cycle
	assert(generation_cycle.repeating_clear_days == 12000)
	assert(workspace._nodes.values().filter(func(candidate: PlannerRecipeNode) -> bool: return !candidate.has_meta("flow_endpoint")).size() == 2)
	var storage_node: PlannerRecipeNode
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.has_meta("storage_unit"):
			storage_node = node
	assert(storage_node != null)
	workspace._select_node(storage_node)
	assert("planned initial charge" in workspace.inspector.text)
	assert(workspace.graph.get_connection_list().any(func(link: Dictionary) -> bool: return link.to_node == storage_node.name))
	var position_key: String = storage_node.get_meta("position_key")
	var position_before: Vector2 = storage_node.position_offset
	var snapshot: Dictionary = workspace._snapshot()
	assert(PlannerDatasetValidation.check_plan(snapshot).is_empty())
	workspace._restore_plan(snapshot)
	await workspace.computation.completed
	await workspace.layout_settled
	assert(storage in workspace._request.periodic_storage)
	assert(workspace._positions[position_key] == [position_before.x, position_before.y])
	storage_node = null
	for node: PlannerRecipeNode in workspace._nodes.values():
		if node.has_meta("storage_unit"):
			storage_node = node
	assert(storage_node && storage_node.position_offset.is_equal_approx(position_before))
	workspace._select_node(storage_node)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/solar-storage-node.png")
	workspace._show_power()
	assert("Periodic generation and storage" in workspace.inspector.text)
	assert("Firm clear-day minimum · credited\n336750 EU / 24000 ticks" in workspace.inspector.text)
	assert("Long-run clear-day average\n4041047218 EU / 288000000 ticks" in workspace.inspector.text)
	assert("planned initial charge" in workspace.inspector.text)
	assert("clear weather" in workspace.inspector.text.to_lower())
	if DisplayServer.get_name() != "headless":
		var lines := workspace.inspector.text.split("\n")
		for line_index in lines.size():
			if "Periodic generation and storage" in lines[line_index]:
				workspace.inspector.scroll_to_line(maxi(0, line_index - 2))
				break
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(
			"res://.plans/artifacts/workspace/solar-cycle-summary.png"
		)
		workspace.inspector.scroll_to_line(workspace.inspector.get_line_count() - 1)
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/solar-power-summary.png")
	print("The bundled solar route and selectable LV storage appear in the graph and power summary.")
	quit()
