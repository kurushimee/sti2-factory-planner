class_name PlannerGraphCanvas
extends GraphEdit

var routes: Array = []
var _paths: Dictionary[String, PackedVector2Array] = {}


func prepare_routes(nodes: Dictionary[String, PlannerRecipeNode]) -> void:
	_paths.clear()
	var by_key: Dictionary[String, PlannerRecipeNode] = {}
	for node: PlannerRecipeNode in nodes.values():
		by_key[node.get_meta("position_key")] = node
	for route: Dictionary in routes:
		if !by_key.has(route.source) || !by_key.has(route.destination):
			continue
		var source: PlannerRecipeNode = by_key[route.source]
		var target: PlannerRecipeNode = by_key[route.destination]
		if !source.output_ports.has(route.resource) || !target.input_ports.has(route.resource):
			continue
		var points := PackedVector2Array()
		for point: Array in route.points:
			points.append(Vector2(point[0], point[1]))
		if points.size() < 2:
			continue
		var start := source.position_offset + source.get_output_port_position(
			source.output_ports[route.resource])
		var end := target.position_offset + target.get_input_port_position(
			target.input_ports[route.resource])
		var offset := start - points[0]
		if (end - points[-1]).distance_to(offset) > 1.0:
			continue
		for index: int in points.size():
			points[index] += offset
		_paths[_path_key(start, end)] = points


func routes_current() -> bool:
	return _paths.size() == routes.size()


func _get_connection_line(from_position: Vector2, to_position: Vector2) -> PackedVector2Array:
	var start := from_position / zoom
	var end := to_position / zoom
	var key := _path_key(start, end)
	if _paths.has(key):
		var path: PackedVector2Array = _paths[key].duplicate()
		for index: int in path.size():
			path[index] *= zoom
		path[0] = from_position
		path[-1] = to_position
		return path
	var middle := (from_position.x + to_position.x) / 2.0
	return PackedVector2Array([from_position, Vector2(middle, from_position.y),
		Vector2(middle, to_position.y), to_position])


func _path_key(start: Vector2, end: Vector2) -> String:
	return "%d,%d:%d,%d" % [roundi(start.x), roundi(start.y), roundi(end.x), roundi(end.y)]
