extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60.0).timeout.connect(func() -> void:
		push_error("Default exact MI goal check timed out.")
		quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	OS.low_processor_usage_mode = false
	await process_frame
	workspace.computation.cancel()
	assert(workspace._request.exact_production)
	workspace._filter_recipes("materials/iron/compressor/main")
	var selected: PackedInt32Array = workspace.recipes_list.get_selected_items()
	assert(selected.size() == 1)
	(workspace.get_node("%Rate") as SpinBox).value = 1
	(workspace.get_node("%AddGoal") as Button).pressed.emit()
	await workspace.computation.completed
	await workspace.layout_settled
	assert(workspace._last_result.status in ["optimal", "feasible"])
	assert(workspace._last_result.exact_production.status == "exact")
	assert(workspace._last_result.flow_roundoff.is_empty())
	assert(workspace._last_result.lines.all(func(line: Dictionary) -> bool:
		return !line.get("operations_per_second_exact", {}).is_empty()))
	assert(workspace._last_result.lines.any(func(line: Dictionary) -> bool:
		return line.recipe == workspace._request.goals[0].recipe))
	print("A new StaTech goal reaches the exact connected MI plan without a flow gap.")
	quit()
