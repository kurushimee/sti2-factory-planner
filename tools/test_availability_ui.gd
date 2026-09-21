extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(30).timeout.connect(func() -> void: push_error("Machine availability check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	var dialog := workspace.get_node("%FactorySettings") as PlannerFactorySettings
	dialog.open_settings(workspace._dataset, workspace._request)
	dialog.get_node("%SettingsSearch").text = "steel bending"
	dialog._filter("steel bending")
	var entries := dialog.get_node("%SettingsEntries") as Tree
	var item := entries.get_root().get_first_child()
	assert(item && !item.is_checked(0))
	assert("not normally obtainable" in item.get_text(0))
	assert("released pack" in item.get_tooltip_text(0))
	item.select(0)
	await process_frame
	entries.grab_focus()
	await process_frame
	assert(dialog.gui_get_focus_owner() == entries)
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/removed-machine-settings.png")
	var toggle := InputEventKey.new()
	toggle.keycode = KEY_ENTER
	toggle.pressed = true
	dialog.push_input(toggle)
	await process_frame
	toggle.pressed = false
	dialog.push_input(toggle)
	await process_frame
	assert("extended_industrialization:steel_bending_machine" in dialog._request.available_machines)
	assert(!workspace._request.has("available_machines"))
	var malformed: Dictionary = workspace._dataset.duplicate()
	malformed.machines = [{"id": "test:machine", "availability": []}]
	assert("availability" in PlannerDatasetValidation.check(malformed))
	print("Removed machines are labeled and disabled by default, with an explicit keyboard override for an owned machine.")
	quit()
