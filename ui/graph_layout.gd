class_name PlannerGraphLayout
extends RefCounted

const COLUMN_GAP := 88.0
const LAYER_GAP := 128.0
const ROW_GAP := 84.0
const GROUP_MARGIN := 22.0


static func arrange(entries: Array[Entry], connections: Array, focus: Array[String] = []) -> Result:
	var result := Result.new()
	if entries.is_empty():
		return result
	var by_key: Dictionary[String, Entry] = {}
	var incoming: Dictionary[String, Array] = {}
	var outgoing: Dictionary[String, Array] = {}
	for entry: Entry in entries:
		by_key[entry.key] = entry
		incoming[entry.key] = []
		outgoing[entry.key] = []
	for connection: Dictionary in connections:
		var source: String = connection.source
		var destination: String = connection.destination
		if (connection.resource == "energy:eu" || !by_key.has(source) ||
				!by_key.has(destination) || source == destination):
			continue
		if !destination in outgoing[source]:
			outgoing[source].append(destination)
			incoming[destination].append(source)
	var keys: Array[String] = []
	keys.assign(by_key.keys())
	keys.sort()
	var roots: Array[String] = []
	for key: String in focus:
		if by_key.has(key) && !key in roots:
			roots.append(key)
	if roots.is_empty():
		for key: String in keys:
			if outgoing[key].is_empty():
				roots.append(key)
	if roots.is_empty():
		roots.assign(keys)
	var state: Dictionary[String, int] = {}
	var layout_incoming: Dictionary[String, Array] = {}
	for key: String in keys:
		layout_incoming[key] = []
	var traversal: Array[String] = roots.duplicate()
	for key: String in keys:
		if !key in traversal:
			traversal.append(key)
	for root: String in traversal:
		if state.get(root, 0) != 0:
			continue
		state[root] = 1
		var stack: Array[Dictionary] = [{"key": root, "cursor": 0}]
		while !stack.is_empty():
			var frame: Dictionary = stack[-1]
			var key: String = frame.key
			if frame.cursor >= incoming[key].size():
				state[key] = 2
				stack.pop_back()
				continue
			var source: String = incoming[key][frame.cursor]
			stack[-1].cursor += 1
			if state.get(source, 0) == 1:
				continue
			layout_incoming[key].append(source)
			if state.get(source, 0) == 0:
				state[source] = 1
				stack.append({"key": source, "cursor": 0})
	var remaining: Dictionary[String, int] = {}
	for key: String in keys:
		remaining[key] = 0
	for destination: String in keys:
		for source: String in layout_incoming[destination]:
			remaining[source] += 1
	var distance: Dictionary[String, int] = {}
	var queue: Array[String] = []
	for key: String in keys:
		if remaining[key] == 0:
			queue.append(key)
	for key: String in roots:
		distance[key] = 0
	var head := 0
	while head < queue.size():
		var destination: String = queue[head]
		head += 1
		for source: String in layout_incoming[destination]:
			if distance.has(destination):
				distance[source] = maxi(distance.get(source, 0), distance[destination] + 1)
			remaining[source] -= 1
			if remaining[source] == 0:
				queue.append(source)
	var maximum := 0
	for value: int in distance.values():
		maximum = maxi(maximum, value)
	for key: String in keys:
		if !distance.has(key):
			distance[key] = maximum + 1
	maximum = 0
	for value: int in distance.values():
		maximum = maxi(maximum, value)
	var layers: Dictionary[int, Array] = {}
	for key: String in keys:
		var layer: int = maximum - distance[key]
		if !layers.has(layer):
			layers[layer] = []
		layers[layer].append(key)
	var slot: Dictionary[String, Vector2i] = {}
	var order_y: Dictionary[String, float] = {}
	var layer_columns: Dictionary[int, int] = {}
	var row_heights: Dictionary[int, float] = {}
	var layer_ids: Array[int] = []
	layer_ids.assign(layers.keys())
	layer_ids.sort()
	layer_ids.reverse()
	var row_limit := 10 if entries.size() < 1000 else ceili(sqrt(float(entries.size())))
	for layer: int in layer_ids:
		var members: Array = layers[layer]
		members.sort_custom(func(a: String, b: String) -> bool:
			var ay := _neighbor_y(a, outgoing, order_y)
			var by := _neighbor_y(b, outgoing, order_y)
			if ay != INF && by != INF && !is_equal_approx(ay, by):
				return ay < by
			if ay != INF && by == INF:
				return true
			if by != INF && ay == INF:
				return false
			return by_key[a].group < by_key[b].group if by_key[a].group != by_key[b].group else a < b
		)
		var columns := maxi(1, ceili(float(members.size()) / row_limit))
		var rows := ceili(float(members.size()) / columns)
		layer_columns[layer] = columns
		for index: int in members.size():
			var row: int = index / columns
			var column: int = index % columns
			var key: String = members[index]
			slot[key] = Vector2i(column, row)
			order_y[key] = float(row) - float(rows - 1) / 2.0 + float(column) * 0.01
			row_heights[row] = maxf(row_heights.get(row, 0.0), by_key[key].size.y)
	layer_ids.reverse()
	var layer_x: Dictionary[int, float] = {}
	var column_x: Dictionary[int, Array] = {}
	var x := 40.0
	for layer: int in layer_ids:
		layer_x[layer] = x
		var widths: Array[float] = []
		widths.resize(layer_columns[layer])
		widths.fill(0.0)
		for key: String in layers[layer]:
			var column: int = slot[key].x
			widths[column] = maxf(widths[column], by_key[key].size.x)
		var offsets: Array[float] = []
		var within := 0.0
		for width: float in widths:
			offsets.append(within)
			within += width + COLUMN_GAP
		column_x[layer] = offsets
		x += within - COLUMN_GAP + LAYER_GAP
	var rows: Array[int] = []
	rows.assign(row_heights.keys())
	rows.sort()
	var row_y: Dictionary[int, float] = {}
	var y := 50.0
	for row: int in rows:
		row_y[row] = y
		y += row_heights[row] + ROW_GAP
	for key: String in keys:
		var layer: int = maximum - distance[key]
		var coordinate: Vector2i = slot[key]
		result.positions[key] = Vector2(layer_x[layer] + column_x[layer][coordinate.x],
			row_y[coordinate.y] + (row_heights[coordinate.y] - by_key[key].size.y) / 2.0)
	var node_buckets: Dictionary[int, Array] = {}
	var group_buckets: Dictionary[int, Array] = {}
	for key: String in keys:
		var bucket := floori(result.positions[key].x / 1000.0)
		if !node_buckets.has(bucket):
			node_buckets[bucket] = []
		node_buckets[bucket].append(key)
	var grouped: Dictionary[String, bool] = {}
	var anchors: Array[String] = keys.duplicate()
	anchors.sort_custom(func(a: String, b: String) -> bool:
		return distance[a] < distance[b] if distance[a] != distance[b] else a < b)
	for anchor: String in anchors:
		if anchor in roots || grouped.has(anchor):
			continue
		var members: Array[String] = [anchor]
		var bounds := Rect2(result.positions[anchor], by_key[anchor].size)
		var sources: Array = incoming[anchor].duplicate()
		sources.sort_custom(func(a: String, b: String) -> bool:
			return (result.positions[a].distance_squared_to(result.positions[anchor]) <
				result.positions[b].distance_squared_to(result.positions[anchor])))
		for source: String in sources:
			if grouped.has(source) || source in roots || source in members:
				continue
			var expanded := bounds.merge(Rect2(result.positions[source], by_key[source].size))
			if expanded.size.x <= 950 && expanded.size.y <= 650:
				members.append(source)
				bounds = expanded
			if members.size() == 5:
				break
		if members.size() < 2:
			continue
		var frame := bounds.grow(GROUP_MARGIN)
		var blocked := false
		var first_bucket := floori(frame.position.x / 1000.0) - 1
		var last_bucket := floori(frame.end.x / 1000.0)
		for bucket: int in range(first_bucket, last_bucket + 1):
			for key: String in node_buckets.get(bucket, []):
				if !key in members && frame.intersects(Rect2(result.positions[key], by_key[key].size)):
					blocked = true
					break
			if blocked:
				break
		if blocked:
			continue
		for bucket: int in range(first_bucket, last_bucket + 1):
			for existing: Rect2 in group_buckets.get(bucket, []):
				if frame.intersects(existing):
					blocked = true
					break
			if blocked:
				break
		if blocked:
			continue
		var group_id := "line_%s" % anchor
		result.groups[group_id] = frame
		result.titles[group_id] = by_key[anchor].label + " line"
		for bucket: int in range(floori(frame.position.x / 1000.0), last_bucket + 1):
			if !group_buckets.has(bucket):
				group_buckets[bucket] = []
			group_buckets[bucket].append(frame)
		for key: String in members:
			grouped[key] = true
	return result


static func _neighbor_y(key: String, outgoing: Dictionary[String, Array],
		order_y: Dictionary[String, float]) -> float:
	var total := 0.0
	var count := 0
	for neighbor: String in outgoing[key]:
		if order_y.has(neighbor):
			total += order_y[neighbor]
			count += 1
	return total / count if count else INF


class Entry:
	var key: String
	var group: String
	var label: String
	var size: Vector2

	func _init(entry_key: String, group_name: String, node_size: Vector2,
			readable_label: String = "") -> void:
		key = entry_key
		group = group_name
		size = node_size
		label = readable_label if !readable_label.is_empty() else group_name


class Result:
	var positions: Dictionary[String, Vector2] = {}
	var groups: Dictionary[String, Rect2] = {}
	var titles: Dictionary[String, String] = {}
