extends SceneTree


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	create_timer(60).timeout.connect(func() -> void: quit(1))
	var service := PlannerComputation.new()
	root.add_child(service)
	var nodes: Array[Dictionary] = []
	var entries: Array[PlannerGraphLayout.Entry] = []
	for key: String in ["a", "b", "c", "d"]:
		nodes.append({"id": key, "width": 280, "height": 210, "ports": [
			{"side": "WEST", "resource": "iron", "x": 0, "y": 80},
			{"side": "EAST", "resource": "iron", "x": 280, "y": 150}]})
		entries.append(PlannerGraphLayout.Entry.new(key, "Metals", Vector2(280, 210)))
	var flows: Array = [
		{"source": "a", "destination": "b", "resource": "iron"},
		{"source": "b", "destination": "c", "resource": "iron"},
		{"source": "c", "destination": "b", "resource": "iron"},
		{"source": "c", "destination": "d", "resource": "iron"}]
	service.failed.connect(func(message: String) -> void: push_error(message); quit(1))
	service.submit({"kind": "graph_layout", "nodes": nodes, "connections": flows, "focus": ["d"]})
	var response: Dictionary = await service.completed
	assert(response.routes.size() == flows.size())
	assert(response.positions.a[0] < response.positions.b[0])
	assert(response.positions.a[0] < response.positions.d[0])
	assert(response.positions.c[0] < response.positions.d[0])
	var layout := PlannerGraphLayout.Result.new()
	for key: String in response.positions:
		var point: Array = response.positions[key]
		layout.positions[key] = Vector2(point[0], point[1])
	layout = PlannerGraphLayout.group_positions(entries, flows, layout)
	for first: PlannerGraphLayout.Entry in entries:
		for second: PlannerGraphLayout.Entry in entries:
			if first != second:
				assert(!Rect2(layout.positions[first.key], first.size).intersects(Rect2(layout.positions[second.key], second.size)))
	print("Native layout service passed branching, cycles, fixed ports and local groups.")
	quit()
