extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(8.0).timeout.connect(func() -> void: push_error("The UI check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	root.add_child(workspace)
	await process_frame
	await process_frame
	assert(root.gui_get_focus_owner() == workspace.get_node("%Search"))
	var key := InputEventKey.new()
	key.keycode = KEY_TAB
	key.pressed = true
	Input.parse_input_event(key)
	await process_frame
	key.pressed = false
	Input.parse_input_event(key)
	assert(root.gui_get_focus_owner() == workspace.get_node("%Recipes"))
	var shoulder := InputEventJoypadButton.new()
	shoulder.button_index = JOY_BUTTON_RIGHT_SHOULDER
	shoulder.pressed = true
	Input.parse_input_event(shoulder)
	await process_frame
	shoulder.pressed = false
	Input.parse_input_event(shoulder)
	assert(root.gui_get_focus_owner() == (workspace.get_node("%Rate") as SpinBox).get_line_edit())
	var feedback := workspace.get_node("%Feedback") as PlannerFeedback
	var capture := AudioEffectCapture.new()
	var bus := AudioServer.get_bus_index("UI")
	assert(bus >= 0)
	AudioServer.add_bus_effect(bus, capture)
	feedback.enabled = true
	feedback.confirm()
	await create_timer(0.2).timeout
	var samples := capture.get_buffer(capture.get_frames_available())
	var peak := 0.0
	for sample: Vector2 in samples:
		peak = maxf(peak, maxf(absf(sample.x), absf(sample.y)))
	assert(peak > 0.001 && peak < 0.1)
	print("Keyboard and gamepad focus navigation passed. The UI audio bus mixed a quiet confirmation tone with peak ", peak, ".")
	quit()
