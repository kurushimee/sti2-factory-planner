class_name PlannerGraphLayout
extends RefCounted

const GROUP_ORDER: Array[String] = [
	"Extraction", "Ore processing", "Metals", "Chemicals", "Fuels",
	"Circuits", "Components", "Machinery", "Power", "Production"
]
const ROW_WIDTH := 6200.0
const GROUP_GAP := 120.0


static func arrange(entries: Array[Entry], connections: Array,
		focus: Array[String] = []) -> Result:
	var result := Result.new()
	var by_key: Dictionary[String, Entry] = {}
	var groups: Dictionary[String, Array] = {}
	var outgoing: Dictionary[String, Array] = {}
	var incoming: Dictionary[String, Array] = {}
	var upstream: Dictionary[String, Array] = {}
	for entry: Entry in entries:
		by_key[entry.key] = entry
		if !groups.has(entry.group):
			groups[entry.group] = []
		groups[entry.group].append(entry.key)
		outgoing[entry.key] = []
		incoming[entry.key] = []
		upstream[entry.key] = []
	for connection: Dictionary in connections:
		var source: String = connection.source
		var destination: String = connection.destination
		if connection.resource == "energy:eu" || !by_key.has(source) || !by_key.has(destination):
			continue
		if !source in upstream[destination]:
			upstream[destination].append(source)
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
	var topological: Array[int] = []
	for component: int in count:
		if indegree[component] == 0:
			ready.append(component)
	var next_index := 0
	while next_index < ready.size():
		var source: int = ready[next_index]
		next_index += 1
		topological.append(source)
		for destination: int in edges[source]:
			indegree[destination] -= 1
			if indegree[destination] == 0:
				ready.append(destination)
	for index: int in range(topological.size() - 1, -1, -1):
		var source: int = topological[index]
		for destination: int in edges[source]:
			rank[source] = maxi(rank[source], rank[destination] + 1)
	var maximum := 0
	for component: int in count:
		maximum = maxi(maximum, rank[component])
	for component: int in count:
		rank[component] = maximum - rank[component]
	var distance: Dictionary[String, int] = {}
	var queue: Array[String] = []
	for key: String in focus:
		if by_key.has(key) && !distance.has(key):
			distance[key] = 0
			queue.append(key)
	var head := 0
	while head < queue.size():
		var current: String = queue[head]
		head += 1
		for previous: String in upstream[current]:
			if !distance.has(previous):
				distance[previous] = distance[current] + 1
				queue.append(previous)
	var names: Array[String] = []
	names.assign(groups.keys())
	names.sort_custom(func(a: String, b: String) -> bool:
		var ai := GROUP_ORDER.find(a)
		var bi := GROUP_ORDER.find(b)
		if ai < 0: ai = GROUP_ORDER.size()
		if bi < 0: bi = GROUP_ORDER.size()
		return ai < bi if ai != bi else a < b
	)
	var cursor_position := Vector2(25, 55)
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
		var x := 24.0
		var height := 0.0
		var local_positions: Dictionary[String, Vector2] = {}
		var column_x: Dictionary[int, float] = {}
		for column: int in column_ids:
			column_x[column] = x
			var width := 0.0
			for key: String in columns[column]:
				width = maxf(width, by_key[key].size.x)
			x += width + 80
		column_ids.reverse()
		for column: int in column_ids:
			columns[column].sort_custom(func(a: String, b: String) -> bool:
				var ay := _neighbor_y(a, outgoing, local_positions)
				var by := _neighbor_y(b, outgoing, local_positions)
				if ay >= 0 && by >= 0 && !is_equal_approx(ay, by):
					return ay < by
				var da: int = distance.get(a, 1000000000)
				var db: int = distance.get(b, 1000000000)
				return da < db if da != db else a < b
			)
			var y := 54.0
			for key: String in columns[column]:
				local_positions[key] = Vector2(column_x[column], y)
				y += by_key[key].size.y + 32
			height = maxf(height, y)
		var size := Vector2(x - 56, height)
		if cursor_position.x > 25 && cursor_position.x + size.x > ROW_WIDTH:
			cursor_position = Vector2(25, cursor_position.y + row_height + GROUP_GAP)
			row_height = 0
		for key: String in local_positions:
			result.positions[key] = cursor_position + local_positions[key]
		var bounds := Rect2(cursor_position, size)
		result.groups[group] = bounds
		cursor_position.x = bounds.end.x + GROUP_GAP
		row_height = maxf(row_height, size.y)
	return result


static func _neighbor_y(key: String, neighbors: Dictionary[String, Array], positions: Dictionary[String, Vector2]) -> float:
	var total := 0.0
	var count := 0
	for neighbor: String in neighbors[key]:
		if positions.has(neighbor):
			total += positions[neighbor].y
			count += 1
	return total / count if count else -1.0


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
