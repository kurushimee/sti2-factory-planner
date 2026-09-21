class_name PlannerComputation
extends Node

signal completed(result: Dictionary)
signal failed(message: String)
signal progress(message: String)

var busy := false
var _process_id := -1
var _job_id := 0
var _result_path := ""
var _input_path := ""
var _cleanup_jobs: Dictionary[int, Dictionary] = {}


func _ready() -> void:
	if OS.has_feature("web"):
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("user://jobs"))
	var pattern := RegEx.new()
	pattern.compile("^(?:job|result)_(\\d+)_(\\d+)(?:_\\d+)?\\.json(?:\\.pending)?$")
	for filename: String in DirAccess.get_files_at("user://jobs"):
		var matched := pattern.search(filename)
		if matched && !_owner_running(matched.get_string(1).to_int()):
			DirAccess.remove_absolute(ProjectSettings.globalize_path("user://jobs/" + filename))


func _process(_delta: float) -> void:
	_cleanup_finished_jobs()
	if !busy:
		return
	if OS.has_feature("web"):
		var response: Variant = JavaScriptBridge.eval("window.plannerBridge ? window.plannerBridge.poll() : ''")
		if response is String && !response.is_empty():
			_accept(PlannerJson.parse(response))
	elif FileAccess.file_exists(_result_path):
		var text := FileAccess.get_file_as_string(_result_path)
		DirAccess.remove_absolute(_result_path)
		_accept(PlannerJson.parse(text))
	elif _process_id > 0 && !OS.is_process_running(_process_id):
		busy = false
		_queue_cleanup(true)
		failed.emit("The calculation process stopped without a result. Your current plan is unchanged.")


func submit(job: Dictionary) -> void:
	cancel()
	_job_id += 1
	job.id = _job_id
	busy = true
	progress.emit("Calculating the connected factory…")
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.submit(%s)" % JSON.stringify(job, "", true, true))
		return
	var job_key := "%d_%d_%d" % [OS.get_process_id(), get_instance_id(), _job_id]
	_input_path = ProjectSettings.globalize_path("user://jobs/job_%s.json" % job_key)
	_result_path = ProjectSettings.globalize_path("user://jobs/result_%s.json" % job_key)
	var file := FileAccess.open(_input_path, FileAccess.WRITE)
	if file == null:
		busy = false
		_queue_cleanup()
		failed.emit("The calculation request could not be saved. Check the application's data folder and available disk space.")
		return
	file.store_string(JSON.stringify(job, "", true, true))
	file.close()
	var runtime_root := ProjectSettings.globalize_path("res://") if OS.has_feature("editor") else OS.get_executable_path().get_base_dir()
	var executable := runtime_root.path_join("runtime/node.exe")
	if !FileAccess.file_exists(executable):
		executable = "node"
	var entry := runtime_root.path_join("kernel/desktop.js")
	_process_id = OS.create_process(executable, PackedStringArray([entry, _input_path, _result_path]), false)
	if _process_id < 0:
		busy = false
		_queue_cleanup()
		failed.emit("The bundled calculation runtime could not start.")


func cancel() -> void:
	var stopped := false
	if busy:
		if OS.has_feature("web"):
			JavaScriptBridge.eval("window.plannerBridge.cancel()")
		elif _process_id > 0:
			if OS.is_process_running(_process_id):
				stopped = OS.kill(_process_id) == OK
			else:
				stopped = true
	_queue_cleanup(stopped)
	busy = false
	_process_id = -1


func _accept(response: Variant) -> void:
	if !(response is Dictionary):
		busy = false
		_queue_cleanup()
		failed.emit("The calculation returned an unreadable result.")
		return
	if response.has("id") && int(response.id) != _job_id:
		return
	if response.has("phase"):
		progress.emit(String(response.phase).replace("_", " ").capitalize())
		return
	busy = false
	_queue_cleanup()
	if response.has("error"):
		failed.emit(str(response.error))
	else:
		completed.emit(response.result)


func _exit_tree() -> void:
	cancel()
	_cleanup_finished_jobs()


func _queue_cleanup(stopped := false) -> void:
	if _input_path.is_empty():
		return
	var job: Dictionary = _cleanup_jobs.get(_process_id, {"paths": PackedStringArray(), "stopped": false})
	var paths: PackedStringArray = job.paths
	paths.append_array(PackedStringArray([_input_path, _result_path, _result_path + ".pending"]))
	job.paths = paths
	job.stopped = job.stopped || stopped || _process_id < 1
	_cleanup_jobs[_process_id] = job
	_input_path = ""
	_result_path = ""


func _cleanup_finished_jobs() -> void:
	for process_id: int in _cleanup_jobs.keys():
		var job: Dictionary = _cleanup_jobs[process_id]
		if !job.stopped && OS.is_process_running(process_id):
			continue
		job.stopped = true
		var remaining := PackedStringArray()
		for path: String in job.paths:
			if FileAccess.file_exists(path) && DirAccess.remove_absolute(path) != OK:
				remaining.append(path)
		if remaining.is_empty():
			_cleanup_jobs.erase(process_id)
		else:
			job.paths = remaining


func _owner_running(process_id: int) -> bool:
	if process_id == OS.get_process_id():
		return true
	# Unix child-process checks reap exited children and reject unrelated owners.
	if OS.get_name() == "Linux":
		return DirAccess.dir_exists_absolute("/proc/%d" % process_id)
	if OS.get_name() == "macOS":
		var output: Array = []
		return OS.execute("/bin/kill", PackedStringArray(["-0", str(process_id)]), output, true) == 0
	return OS.is_process_running(process_id)
