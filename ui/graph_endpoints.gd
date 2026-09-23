class_name PlannerGraphEndpoints
extends RefCounted


static func build(result: Dictionary) -> Dictionary:
	var endpoints: Dictionary[String, Dictionary] = {}
	var flows: Dictionary[String, Dictionary] = {}
	var tolerances: Dictionary[String, float] = {}
	for balance: Dictionary in result.get("balances", []):
		tolerances[str(balance.resource)] = float(balance.numerical_tolerance)
	for connection: Dictionary in result.get("connections", []):
		if float(connection.rate) <= 0:
			continue
		_add_flow(flows, connection)
		if str(connection.source).begins_with("external:"):
			_add_endpoint(endpoints, connection.source, "external", connection.resource)
		if str(connection.destination).begins_with("goal:"):
			_add_endpoint(endpoints, connection.destination, "goal", connection.resource)
	for gap: Dictionary in result.get("flow_roundoff_links", []):
		if float(gap.rate) <= 0:
			continue
		_add_flow(flows, gap)
		_add_endpoint(endpoints, gap.source, "gap", gap.resource)
		if str(gap.destination).begins_with("goal:"):
			_add_endpoint(endpoints, gap.destination, "goal", gap.resource)
	for surplus: Dictionary in result.get("retained", []):
		if float(surplus.rate) <= 0:
			continue
		var key: String = "surplus:" + str(surplus.resource)
		var tolerance: float = tolerances.get(str(surplus.resource), 0.0)
		var kind := "remainder" if float(surplus.rate) <= tolerance else "surplus"
		_add_endpoint(endpoints, key, kind, surplus.resource)
		if kind == "surplus":
			endpoints[key].kind = "surplus"
		if str(surplus.source).begins_with("external:"):
			_add_endpoint(endpoints, surplus.source, "external", surplus.resource)
		_add_flow(flows, {"source": surplus.source, "destination": key,
			"resource": surplus.resource, "rate": surplus.rate})
	for supply: Dictionary in result.get("external", []):
		var key: String = "external:" + str(supply.resource)
		if endpoints.has(key):
			endpoints[key].rate += float(supply.rate)
	for target: Dictionary in result.get("targets", []):
		var key: String = "goal:" + str(target.resource)
		if endpoints.has(key):
			endpoints[key].rate += float(target.rate)
	for gap: Dictionary in result.get("flow_roundoff_links", []):
		if float(gap.rate) > 0 && endpoints.has(gap.source):
			endpoints[gap.source].rate += float(gap.rate)
	for surplus: Dictionary in result.get("retained", []):
		var key: String = "surplus:" + str(surplus.resource)
		if endpoints.has(key):
			endpoints[key].rate += float(surplus.rate)
	for exact: Dictionary in result.get("exact_production", {}).get("endpoints", []):
		if endpoints.has(exact.key):
			endpoints[exact.key].rate_exact = exact.rate
			if exact.has("rate_eu_per_tick"):
				endpoints[exact.key].rate_eu_per_tick_exact = exact.rate_eu_per_tick
	var keys: Array[String] = []
	keys.assign(endpoints.keys())
	keys.sort()
	var nodes: Array[Dictionary] = []
	for key: String in keys:
		nodes.append(endpoints[key])
	keys.clear()
	keys.assign(flows.keys())
	keys.sort()
	var connections: Array[Dictionary] = []
	for key: String in keys:
		connections.append(flows[key])
	return {"nodes": nodes, "connections": connections}


static func _add_endpoint(endpoints: Dictionary[String, Dictionary], key: String,
		kind: String, resource: String) -> void:
	if !endpoints.has(key):
		endpoints[key] = {"key": key, "kind": kind, "resource": resource, "rate": 0.0}


static func _add_flow(flows: Dictionary[String, Dictionary], connection: Dictionary) -> void:
	var key := JSON.stringify([connection.source, connection.destination, connection.resource])
	if !flows.has(key):
		flows[key] = connection.duplicate()
	else:
		flows[key].rate += float(connection.rate)
