extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	assert(PlannerDisplay.readable_name("fluid:modern_industrialization:sulfuric_light_fuel", "modern industrialization:sulfuric light fuel") == "Sulfuric Light Fuel")
	create_timer(60).timeout.connect(func() -> void: push_error("Array import check timed out."); quit(1))
	var workspace: PlannerWorkspace = load("res://ui/workspace.tscn").instantiate()
	workspace.restore_saved_plan = false
	root.add_child(workspace)
	await process_frame
	workspace.computation.cancel()
	var evidence: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/provenance/array-save-report.json"))
	var reconstruction := {"goals": [], "machine_setups": {}}
	for saved: Dictionary in evidence.arrays:
		var recipe: Dictionary = workspace._recipes[saved.recipe]
		reconstruction.goals.append({"kind": "capacity", "recipe": saved.recipe, "resource": recipe.primary, "configuration": saved.configuration, "machines": 1})
		reconstruction.machine_setups[saved.recipe] = [{"machine": saved.machine, "setup": saved.setup, "configuration": saved.configuration}]
	workspace._request = {"goals": [], "available_machines": [], "external": [{"resource": "energy:eu"}, {"resource": "item:spectrum:copper_cluster"}, {"resource": "fluid:modern_industrialization:crude_oil"}]}
	workspace._job_kind = "import_world"
	workspace._calculated({"machines": [], "providers": [], "unsupported": [], "errors": [], "reconstruction": reconstruction})
	workspace.get_node("%Notice").hide()
	for saved: Dictionary in evidence.arrays:
		assert(saved.machine in workspace._request.available_machines)
		assert(saved.contained_machine.id in workspace._request.available_machines)
	await workspace.computation.completed
	assert(workspace._last_result.status == "optimal")
	assert(workspace._last_result.lines.size() == 2)
	for line: Dictionary in workspace._last_result.lines:
		assert(line.machines == 1)
		assert(line.configuration_details.setup.contained_count == 8)
		assert(line.configuration_details.setup.upgrade_count == 4)
	if DisplayServer.get_name() != "headless":
		await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://.plans/artifacts/workspace/array-import-plan.png")
	print("Both saved array goals enable their contained machines and recalculate into buildable allocations.")
	quit()
