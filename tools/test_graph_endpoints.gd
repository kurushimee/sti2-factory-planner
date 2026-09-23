extends SceneTree


func _initialize() -> void:
	var result := {"connections": [
		{"source": "external:ore", "destination": "smelt|furnace", "resource": "ore", "rate": 1.0},
		{"source": "external:ore", "destination": "smelt|furnace", "resource": "ore", "rate": 2.0},
		{"source": "smelt|furnace", "destination": "press|press", "resource": "ingot", "rate": 2.0},
		{"source": "press|press", "destination": "goal:plate", "resource": "plate", "rate": 1.0},
	], "external": [{"resource": "ore", "rate": 3.0}],
		"targets": [{"resource": "plate", "rate": 1.0}],
		"retained": [{"source": "press|press", "resource": "plate", "rate": 0.5}]}
	var graph: Dictionary = PlannerGraphEndpoints.build(result)
	assert(graph.nodes.size() == 3)
	assert(graph.connections.size() == 4)
	assert(graph.connections.any(func(flow: Dictionary) -> bool:
		return flow.source == "external:ore" && flow.destination == "smelt|furnace" && flow.rate == 3.0))
	assert(graph.connections.any(func(flow: Dictionary) -> bool:
		return flow.source == "press|press" && flow.destination == "surplus:plate" && flow.rate == 0.5))
	assert(graph.nodes.any(func(node: Dictionary) -> bool:
		return node.key == "goal:plate" && node.rate == 1.0))
	assert(graph.nodes.any(func(node: Dictionary) -> bool:
		return node.key == "surplus:plate" && node.rate == 0.5))
	var precise := PlannerGraphEndpoints.build({"connections": [
		{"source": "external:dust", "destination": "smelt|furnace", "resource": "dust", "rate": 1e-12}],
		"flow_roundoff_links": [{"source": "unallocated:dust", "destination": "smelt|furnace",
			"resource": "dust", "rate": 1e-15}],
		"retained": [{"source": "smelt|furnace", "resource": "ingot", "rate": 1e-15}],
		"balances": [{"resource": "ingot", "numerical_tolerance": 1e-14}]})
	assert(precise.connections.size() == 3)
	assert(precise.nodes.any(func(node: Dictionary) -> bool:
		return node.key == "unallocated:dust" && node.kind == "gap" && node.rate == 1e-15))
	assert(precise.nodes.any(func(node: Dictionary) -> bool:
		return node.key == "surplus:ingot" && node.kind == "remainder" && node.rate == 1e-15))
	var exact := PlannerGraphEndpoints.build({"connections": [
		{"source": "external:ore", "destination": "press|press", "resource": "ore", "rate": 0.25}],
		"external": [{"resource": "ore", "rate": 0.25}],
		"exact_production": {"endpoints": [{"key": "external:ore",
			"rate": {"numerator": "1", "denominator": "4", "display": "1/4"}}]}})
	assert(exact.nodes[0].rate_exact.display == "1/4")
	print("External supplies, requested output, and retained output have graph endpoints.")
	quit()
