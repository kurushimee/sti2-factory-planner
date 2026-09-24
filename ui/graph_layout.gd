class_name PlannerGraphLayout
extends RefCounted

const GROUP_MARGIN := 22.0


static func group_positions(entries: Array[Entry], connections: Array, result: Result,
		roots: Array[String] = []) -> Result:
	var by_key: Dictionary[String, Entry] = {}
	var incoming: Dictionary[String, Array] = {}
	var keys: Array[String] = []
	for entry: Entry in entries:
		by_key[entry.key] = entry
		incoming[entry.key] = []
		keys.append(entry.key)
	keys.sort()
	for connection: Dictionary in connections:
		if connection.resource != "energy:eu" && by_key.has(connection.source) && by_key.has(connection.destination):
			incoming[connection.destination].append(connection.source)
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
		return result.positions[a].x > result.positions[b].x if result.positions[a].x != result.positions[b].x else a < b)
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
