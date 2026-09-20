class_name PlannerComputation
extends Node

signal completed(result: Dictionary)
signal failed(message: String)
signal progress(message: String)

var busy := false
var _process_id := -1
var _job_id := 0
var _result_path := ""


func _process(_delta: float) -> void:
	if !busy:
		return
	if OS.has_feature("web"):
		var response: Variant = JavaScriptBridge.eval("window.plannerBridge ? window.plannerBridge.poll() : ''")
		if response is String && !response.is_empty():
			_accept(JSON.parse_string(response))
	elif FileAccess.file_exists(_result_path):
		var text := FileAccess.get_file_as_string(_result_path)
		DirAccess.remove_absolute(_result_path)
		_accept(JSON.parse_string(text))
	elif _process_id > 0 && !OS.is_process_running(_process_id):
		busy = false
		failed.emit("The calculation process stopped without a result. Your current plan is unchanged.")


func submit(job: Dictionary) -> void:
	cancel()
	_job_id += 1
	job.id = _job_id
	busy = true
	progress.emit("Calculating the connected factory…")
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.plannerBridge.submit(%s)" % JSON.stringify(job))
		return
	var input_path := ProjectSettings.globalize_path("user://job_%d_%d.json" % [OS.get_process_id(), _job_id])
	_result_path = ProjectSettings.globalize_path("user://result_%d_%d.json" % [OS.get_process_id(), _job_id])
	var file := FileAccess.open(input_path, FileAccess.WRITE)
	file.store_string(JSON.stringify(job))
	file.close()
	var runtime_root := ProjectSettings.globalize_path("res://") if OS.has_feature("editor") else OS.get_executable_path().get_base_dir()
	var executable := runtime_root.path_join("runtime/node.exe")
	if !FileAccess.file_exists(executable):
		executable = "node"
	var entry := runtime_root.path_join("kernel/desktop.js")
	_process_id = OS.create_process(executable, PackedStringArray([entry, input_path, _result_path]), false)
	if _process_id < 0:
		busy = false
		failed.emit("The bundled calculation runtime could not start.")


func cancel() -> void:
	if busy:
		if OS.has_feature("web"):
			JavaScriptBridge.eval("window.plannerBridge.cancel()")
		elif _process_id > 0 && OS.is_process_running(_process_id):
			OS.kill(_process_id)
	busy = false
	_process_id = -1


func _accept(response: Variant) -> void:
	if !(response is Dictionary):
		busy = false
		failed.emit("The calculation returned an unreadable result.")
		return
	if response.has("id") && int(response.id) != _job_id:
		return
	if response.has("phase"):
		progress.emit(String(response.phase).replace("_", " ").capitalize())
		return
	busy = false
	if response.has("error"):
		failed.emit(str(response.error))
	else:
		completed.emit(response.result)


func _exit_tree() -> void:
	cancel()
