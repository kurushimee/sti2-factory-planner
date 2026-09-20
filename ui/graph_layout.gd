class_name PlannerGraphLayout
extends RefCounted

const GROUP_ORDER: Array[String] = ["Extraction", "Ore processing", "Metals", "Chemicals", "Fuels", "Circuits", "Components", "Machinery", "Power", "Production"]


static func arrange(entries: Array[Entry], connections: Array) -> Result:
	var result := Result.new()
	var by_key: Dictionary[String, Entry] = {}
	var groups: Dictionary[String, Array] = {}
	var outgoing: Dictionary[String, Array] = {}
	var incoming: Dictionary[String, Array] = {}
	for entry: Entry in entries:
		by_key[entry.key] = entry
		if !groups.has(entry.group):
			groups[entry.group] = []
		groups[entry.group].append(entry.key)
		outgoing[entry.key] = []
		incoming[entry.key] = []
	for connection: Dictionary in connections:
		var source: String = connection.source
		var destination: String = connection.destination
		if connection.resource == "energy:eu" || !by_key.has(source) || !by_key.has(destination):
			continue
		if by_key[source].group != by_key[destination].group || destination in outgoing[source]:
			continue
		outgoing[source].append(destination)
		incoming[destination].append(source)
	var keys: Array[String] = []
	keys.assign(by_key.keys())
	keys.sort()
	# Iterative Kosaraju traversal keeps recycling loops together without deep recursion.
	var visited: Dictionary[String, bool] = {}
	var finished: Array[String] = []
	var cursor: Dictionary[String, int] = {}
	for key: String in keys:
		if visited.has(key):
			continue
		var stack: Array[String] = [key]
		visited[key] = true
		while !stack.is_empty():
			var current: String = stack.back()
			var index: int = cursor.get(current, 0)
			if index < outgoing[current].size():
				cursor[current] = index + 1
				var next: String = outgoing[current][index]
				if !visited.has(next):
					visited[next] = true
					stack.append(next)
			else:
				finished.append(stack.pop_back())
	var components: Dictionary[String, int] = {}
	var count := 0
	finished.reverse()
	for key: String in finished:
		if components.has(key):
			continue
		var stack: Array[String] = [key]
		components[key] = count
		while !stack.is_empty():
			var current: String = stack.pop_back()
			for previous: String in incoming[current]:
				if !components.has(previous):
					components[previous] = count
					stack.append(previous)
		count += 1
	var edges: Dictionary[int, Array] = {}
	var indegree: Dictionary[int, int] = {}
	var rank: Dictionary[int, int] = {}
	for component: int in count:
		edges[component] = []
		indegree[component] = 0
		rank[component] = 0
	for key: String in keys:
		var source: int = components[key]
		for target: String in outgoing[key]:
			var destination: int = components[target]
			if source != destination && !destination in edges[source]:
				edges[source].append(destination)
				indegree[destination] += 1
	var ready: Array[int] = []
	for component: int in count:
		if indegree[component] == 0:
			ready.append(component)
	var next_index := 0
	while next_index < ready.size():
		var source: int = ready[next_index]
		next_index += 1
		for destination: int in edges[source]:
			rank[destination] = maxi(rank[destination], rank[source] + 1)
			indegree[destination] -= 1
			if indegree[destination] == 0:
				ready.append(destination)
	var names: Array[String] = []
	names.assign(groups.keys())
	names.sort_custom(func(a: String, b: String) -> bool:
		var ai := GROUP_ORDER.find(a)
		var bi := GROUP_ORDER.find(b)
		if ai < 0: ai = GROUP_ORDER.size()
		if bi < 0: bi = GROUP_ORDER.size()
		return ai < bi if ai != bi else a < b
	)
	var origin := Vector2(25, 55)
	var row_height := 0.0
	for index: int in names.size():
		var group: String = names[index]
		var columns: Dictionary[int, Array] = {}
		groups[group].sort()
		for key: String in groups[group]:
			var column: int = rank[components[key]]
			if !columns.has(column): columns[column] = []
			columns[column].append(key)
		var column_ids: Array[int] = []
		column_ids.assign(columns.keys())
		column_ids.sort()
		var x := origin.x + 24
		var height := 0.0
		for column: int in column_ids:
			var y := origin.y + 54
			var width := 0.0
			for key: String in columns[column]:
				result.positions[key] = Vector2(x, y)
				y += by_key[key].size.y + 32
				width = maxf(width, by_key[key].size.x)
			height = maxf(height, y - origin.y)
			x += width + 80
		var bounds := Rect2(origin, Vector2(x - origin.x - 56, height))
		result.groups[group] = bounds
		row_height = maxf(row_height, height)
		if index % 2 == 0:
			origin.x = bounds.end.x + 100
		else:
			origin = Vector2(25, origin.y + row_height + 100)
			row_height = 0
	return result


class Entry:
	var key: String
	var group: String
	var size: Vector2

	func _init(entry_key: String, group_name: String, node_size: Vector2) -> void:
		key = entry_key
		group = group_name
		size = node_size


class Result:
	var positions: Dictionary[String, Vector2] = {}
	var groups: Dictionary[String, Rect2] = {}
