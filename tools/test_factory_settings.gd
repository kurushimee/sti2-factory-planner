extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(20).timeout.connect(func() -> void: push_error("Factory settings timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	root.add_child(workspace)
	await process_frame
	workspace.computation.cancel()
	assert(workspace._load_dataset(JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json"))))
	workspace._request = {"goals": [{"recipe": "assemble", "resource": "motor", "rate": 2}]}
	workspace._recalculate()
	await workspace.computation.completed
	await process_frame
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	dialog.get_node("%SettingsCategory").select(4)
	dialog._category_changed(4)
	dialog.get_node("%SettingsSearch").text = "coal"
	dialog._filter("coal")
	var entries := dialog.get_node("%SettingsEntries") as Tree
	var item := entries.get_root().get_first_child()
	item.select(0)
	await process_frame
	entries.grab_focus()
	await process_frame
	assert(dialog.gui_get_focus_owner() == entries)
	var key := InputEventKey.new()
	key.keycode = KEY_ENTER
	key.pressed = true
	dialog.push_input(key)
	await process_frame
	key.pressed = false
	dialog.push_input(key)
	await process_frame
	assert(dialog._request.external.size() == 1)
	assert(dialog._request.external[0].resource == "coal")
	dialog.get_node("%SupplyUnlimited").button_pressed = false
	dialog.get_node("%SupplyLimit").value = 0.5
	dialog.get_node("%SupplyCost").value = 2
	dialog.get_node("%Reserve").value = 25
	dialog.get_node("%Overhead").value = 4
	if DisplayServer.get_name() != "headless":
		OS.low_processor_usage_mode = false
		await create_timer(0.2).timeout
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/factory-settings.png")
	dialog.confirmed.emit()
	dialog.hide()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.external[0].limit == 0.5)
	assert(workspace._request.external[0].cost == 2)
	assert(workspace._last_result.power.reserve_fraction == 0.25)
	assert(workspace._last_result.power.infrastructure_and_goal_eu_per_tick == 4)
	workspace._undo_action()
	await workspace.computation.completed
	await process_frame
	assert(!workspace._request.has("external"))
	var original: Dictionary = workspace._request.duplicate(true)
	original.disabled_machines = ["Assembler"]
	dialog.open_settings(workspace._dataset, original)
	dialog.get_node("%SettingsCategory").select(0)
	assert(!"Assembler" in dialog._request.available_machines)
	assert(!dialog._request.has("disabled_machines"))
	dialog._request.available_machines.append("Assembler")
	dialog.hide()
	assert(original.disabled_machines == ["Assembler"])
	assert(!original.has("available_machines"))
	workspace._request.external = [{"resource": "coal", "limit": 0.5}]
	workspace._import_json(JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json")))
	await workspace.computation.completed
	await process_frame
	assert(!workspace._request.has("external"))
	assert(workspace._request.goals.is_empty())
	workspace._undo_action()
	await workspace.computation.completed
	await process_frame
	assert(workspace._request.external[0].limit == 0.5)
	assert(workspace._request.goals.size() == 1)
	print("Factory settings passed keyboard supply selection, rate limits, costs, power reserve, overhead, and undo.")
	quit()
