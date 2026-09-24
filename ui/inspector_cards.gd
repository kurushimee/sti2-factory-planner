class_name PlannerInspectorCards
extends ScrollContainer

signal node_requested(key: String)
signal route_requested(resource: String)
signal ingredient_requested(recipe: String, slot: int)

@onready var content: VBoxContainer = %Content


func show_line(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String], startup: Dictionary, construction: Dictionary, context: Dictionary = {}) -> void:
	_clear()
	_heading(PlannerDisplay.recipe_name(recipe))
	var configuration: Dictionary = line.get("configuration_details", {})
	var capacity: Dictionary = configuration.get("capacity", {})
	_section("Build")
	_row("Machines", "%d × %s" % [int(line.machines), PlannerDisplay.machine_name(line.machine, resources)])
	_row("Upgrades", PlannerDisplay.loadout(configuration, resources).replace("\n", " · "))
	if line.has("route_preference"):
		_section("Route choice")
		_note(str(line.route_preference.reason))
	_flow_section("Outputs", line.outputs, resources)
	_flow_section("Inputs", line.inputs, resources)
	if !context.get("routes", []).is_empty():
		_section("Production routes")
		for choice: Dictionary in context.routes:
			_row(choice.name, "%d available%s" % [choice.count, " · pinned" if choice.pinned else ""])
			_action("Choose source", _request_route.bind(choice.resource))
	if !context.get("ingredients", []).is_empty():
		_section("Ingredient choices")
		for choice: Dictionary in context.ingredients:
			_row("Slot %d" % (int(choice.slot) + 1), choice.name + (" · pinned" if choice.pinned else ""))
			_action("Choose ingredient", _request_ingredient.bind(str(recipe.id), int(choice.slot)))
	_relationships("Supplied by", context.get("incoming", []), resources)
	_relationships("Used by", context.get("outgoing", []), resources)
	_section("Capacity")
	_exact_row("Operations", line.operations_per_second, line.get("operations_per_second_exact", {}), "/s")
	_exact_row("Full speed", line.capacity_per_second, line.get("capacity_per_second_exact", {}), " ops/s")
	_exact_row("Utilization", line.utilization * 100, line.get("utilization_percent_exact", {}), "%")
	_section("Power")
	_exact_row("Running", line.power_eu_per_tick, line.get("power_eu_per_tick_exact", {}), " EU/t")
	if capacity.has("peak_eu_per_tick"):
		_row("Peak / machine", PlannerDisplay.number(capacity.peak_eu_per_tick) + " EU/t")
	if capacity.has("ticks_per_batch"):
		_row("Batch", PlannerDisplay.number(capacity.ticks_per_batch) + " ticks")
	if capacity.has("warmup_ticks"):
		_row("Warm-up", PlannerDisplay.number(float(capacity.warmup_ticks) / 20.0) + " s")
	if !configuration.get("build_requirements", []).is_empty():
		_section("Per-machine parts")
		for part: Dictionary in configuration.build_requirements:
			_row(resources.get(part.resource, PlannerDisplay.readable_name(part.resource)),
				PlannerDisplay.number(part.amount))
	var key := String(line.recipe) + "|" + String(line.configuration)
	var stocks: Array[Dictionary] = []
	for stock: Dictionary in startup.get("resources", []):
		if key in stock.get("origins", []):
			stocks.append(stock)
	if !stocks.is_empty():
		_section("Startup stock")
		for stock: Dictionary in stocks:
			_row(resources.get(stock.resource, PlannerDisplay.readable_name(stock.resource)),
				PlannerDisplay.number(stock.quantity) + (" mB" if String(stock.resource).begins_with("fluid:") else ""))
	if !construction.is_empty():
		_section("Factory construction")
		_row("Material cost", PlannerDisplay.number(construction.material_cost))
		_row("Work", PlannerDisplay.number(construction.work_seconds) + " machine-s")
	_section("Recipe")
	_row("Source", PlannerDisplay.readable_name(str(recipe.get("origin", "Custom dataset"))), str(recipe.get("source_id", recipe.id)))
	for condition: Dictionary in recipe.get("conditions", []):
		_note("Condition: " + JSON.stringify(condition))
	for assumption: String in configuration.get("assumptions", []):
		_note(assumption)
	if startup.get("preview_omitted", false):
		_note("Warm-up stock is not calculated in this preview.")
	scroll_vertical = 0


func show_plan(result: Dictionary) -> void:
	_clear()
	_heading("Factory totals")
	var power: Dictionary = result.get("power", {})
	var machines := 0
	for line: Dictionary in result.get("lines", []):
		machines += int(line.get("machines", 0))
	_section("Build")
	_row("Machines", str(machines))
	_row("Lines", str(result.get("lines", []).size()))
	_section("Power")
	_power_metric("Running draw", power, "consumption_eu_per_tick")
	_power_metric("All machine peaks", power, "production_peak_eu_per_tick")
	if int(power.get("production_peak_missing_lines", 0)) > 0:
		_row("Peak coverage", "%d lines lack a peak rating" % int(power.production_peak_missing_lines))
	else:
		_note("Peak assumes every installed machine runs at its rated maximum.")
	_power_metric("External supply", power, "external_eu_per_tick")
	if float(power.get("gross_generation_eu_per_tick", 0)) > 0:
		_power_metric("Gross generation", power, "gross_generation_eu_per_tick")
		_power_metric("Generator support", power, "generation_related_consumption_eu_per_tick")
		_power_metric("Net generation", power, "net_generation_eu_per_tick")
	if float(power.get("infrastructure_and_goal_eu_per_tick", 0)) > 0:
		_power_metric("Other demand", power, "infrastructure_and_goal_eu_per_tick")
	_section("Calculation")
	_row("Result", "Optimal" if result.get("optimal", false) else "Feasible · cost unproven")
	var optimization: Dictionary = result.get("optimization", {})
	if optimization.get("lower_bound") != null:
		_row("Cost bound", PlannerDisplay.number(float(optimization.lower_bound)))
	if optimization.get("relative_gap") != null:
		_row("Cost gap", PlannerDisplay.number(float(optimization.relative_gap) * 100.0) + "%")
	var construction: Dictionary = result.get("construction", {})
	if !construction.is_empty():
		_section("Construction")
		_row("Material cost", PlannerDisplay.number(float(construction.material_cost)))
		_row("Work", PlannerDisplay.number(float(construction.work_seconds)) + " machine-s")
	scroll_vertical = 0


func show_endpoint(endpoint: Dictionary, resources: Dictionary[String, String]) -> void:
	_clear()
	var title: String = {
		"external": "External supply", "goal": "Requested output", "surplus": "Surplus",
		"gap": "Unallocated demand", "remainder": "Flow remainder"
	}.get(endpoint.kind, "Flow")
	_heading(title)
	_section(resources.get(endpoint.resource, PlannerDisplay.readable_name(endpoint.resource)))
	var exact: Dictionary = endpoint.get("rate_eu_per_tick_exact", {}) if endpoint.resource == "energy:eu" else endpoint.get("rate_exact", {})
	var value: float = endpoint.rate / 20.0 if endpoint.resource == "energy:eu" else endpoint.rate
	_exact_row("Rate", value, exact, " EU/t" if endpoint.resource == "energy:eu" else " mB/s" if String(endpoint.resource).begins_with("fluid:") else " /s")
	if endpoint.kind == "gap":
		_note("No supply is credited for this demand.")
	scroll_vertical = 0


func show_group(title: String, members: int) -> void:
	_clear()
	_heading(title)
	_section("Group")
	_row("Nodes", str(members))
	_note("Drag the title to move members. Resize the border to change membership.")
	scroll_vertical = 0


func _clear() -> void:
	for child: Node in content.get_children():
		content.remove_child(child)
		child.queue_free()


func _heading(value: String) -> void:
	var label := Label.new()
	label.text = value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", 21)
	content.add_child(label)


func _section(value: String) -> void:
	if content.get_child_count() > 0:
		content.add_child(HSeparator.new())
	var label := Label.new()
	label.text = value
	label.theme_type_variation = &"SectionLabel"
	content.add_child(label)


func _row(label_text: String, value_text: String, exact: String = "") -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var label := Label.new()
	label.text = label_text
	label.custom_minimum_size.x = 105
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.theme_type_variation = &"MutedLabel"
	row.add_child(label)
	var value := Label.new()
	value.text = value_text
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	value.tooltip_text = exact
	row.add_child(value)
	content.add_child(row)


func _exact_row(label_text: String, numeric: float, exact: Variant, suffix: String) -> void:
	var record: Dictionary = exact if exact is Dictionary else {}
	_row(label_text, PlannerDisplay.compact_exact(record, numeric) + suffix,
		str(record.get("display", PlannerDisplay.number(numeric))) + suffix)


func _power_metric(label_text: String, power: Dictionary, field: String) -> void:
	var numeric := float(power.get(field, 0))
	var exact: Dictionary = power.get(field + "_exact", {})
	var full: String = str(exact.get("display", PlannerDisplay.number(numeric))) + " EU/t"
	var card := VBoxContainer.new()
	card.add_theme_constant_override("separation", 1)
	var label := Label.new()
	label.text = label_text
	label.theme_type_variation = &"MutedLabel"
	card.add_child(label)
	var value := Label.new()
	value.text = PlannerDisplay.number(numeric) + " EU/t"
	value.add_theme_font_size_override("font_size", 19)
	value.tooltip_text = full
	card.add_child(value)
	content.add_child(card)


func _flow_section(title: String, flows: Array, resources: Dictionary[String, String]) -> void:
	_section(title)
	if flows.is_empty():
		_row("None", "")
	for flow: Dictionary in flows:
		var resource: String = flow.resource
		var provided: Variant = flow.get("rate_eu_per_tick_exact", {}) if resource == "energy:eu" else flow.get("rate_exact", {})
		var exact: Dictionary = provided if provided is Dictionary else {}
		var suffix := " EU/t" if resource == "energy:eu" else " mB/s" if resource.begins_with("fluid:") else " /s"
		var numeric: float = flow.rate / 20.0 if resource == "energy:eu" else flow.rate
		_row(resources.get(resource, PlannerDisplay.readable_name(resource)),
			PlannerDisplay.compact_exact(exact, numeric) + suffix,
			str(exact.get("display", PlannerDisplay.number(numeric))) + suffix)


func _note(value: String) -> void:
	var label := Label.new()
	label.text = value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.theme_type_variation = &"MutedLabel"
	content.add_child(label)


func _relationships(title: String, links: Array, resources: Dictionary[String, String]) -> void:
	_section(title)
	if links.is_empty():
		_row("None", "")
	for link: Dictionary in links:
		var resource: String = link.resource
		var rate: String = PlannerDisplay.flow_rate(resource, float(link.rate), link.get("rate_exact", {}), link.get("rate_eu_per_tick_exact", {}))
		_action("%s · %s · %s" % [resources.get(resource, PlannerDisplay.readable_name(resource)), rate, link.title],
			_request_node.bind(str(link.key)), str(link.get("exact", "")))


func _action(title: String, callback: Callable, detail: String = "") -> void:
	var button := Button.new()
	button.text = title
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.tooltip_text = detail
	button.pressed.connect(callback)
	content.add_child(button)


func _request_node(key: String) -> void:
	node_requested.emit(key)


func _request_route(resource: String) -> void:
	route_requested.emit(resource)


func _request_ingredient(recipe: String, slot: int) -> void:
	ingredient_requested.emit(recipe, slot)
