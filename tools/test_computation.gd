extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(15).timeout.connect(func() -> void: push_error("Temporary calculation cleanup timed out."); quit(1))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://jobs"))
	for filename: String in ["job_2147483647_1.json", "result_2147483647_1.json.progress", "result_2147483647_1.json.progress.pending", "keep.json"]:
		var file := FileAccess.open("user://jobs/" + filename, FileAccess.WRITE)
		file.store_string("{}")
		file.close()
	var service := PlannerComputation.new()
	root.add_child(service)
	assert(!FileAccess.file_exists("user://jobs/job_2147483647_1.json"))
	assert(!FileAccess.file_exists("user://jobs/result_2147483647_1.json.progress"))
	assert(!FileAccess.file_exists("user://jobs/result_2147483647_1.json.progress.pending"))
	assert(FileAccess.file_exists("user://jobs/keep.json"))
	DirAccess.remove_absolute(ProjectSettings.globalize_path("user://jobs/keep.json"))
	var dataset: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string("res://data/example.json"))
	var job := {"dataset": dataset, "request": {"goals": [{"resource": "motor", "rate": 1.0 / 3600.0}]}}
	var second_service := PlannerComputation.new()
	root.add_child(second_service)
	second_service.submit(job.duplicate(true))
	service.submit(job.duplicate(true))
	var captured: Dictionary = PlannerJson.parse(FileAccess.get_file_as_string(service._input_path))
	assert(captured.request.goals[0].rate == job.request.goals[0].rate)
	assert(service._input_path != second_service._input_path)
	assert(service._result_path != second_service._result_path)
	var second_paths := PackedStringArray([second_service._input_path, second_service._result_path])
	second_service.cancel()
	var paths := PackedStringArray([service._input_path, service._result_path])
	await service.completed
	while !service._cleanup_jobs.is_empty():
		await process_frame
	for path: String in paths:
		assert(!FileAccess.file_exists(path))
	while !second_service._cleanup_jobs.is_empty():
		await process_frame
	for path: String in second_paths:
		assert(!FileAccess.file_exists(path))
	service.submit(job.duplicate(true))
	paths = PackedStringArray([service._input_path, service._result_path, service._result_path + ".pending"])
	service.cancel()
	while !service._cleanup_jobs.is_empty():
		await process_frame
	for path: String in paths:
		assert(!FileAccess.file_exists(path))
	service.submit({"dataset": {}, "request": {}})
	paths = PackedStringArray([service._input_path, service._result_path])
	await service.failed
	while !service._cleanup_jobs.is_empty():
		await process_frame
	for path: String in paths:
		assert(!FileAccess.file_exists(path))
	print("Completed, canceled, and failed calculations removed their temporary job files.")
	quit()
