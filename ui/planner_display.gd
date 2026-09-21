class_name PlannerDisplay
extends RefCounted


static func readable_name(identity: String, supplied: String = "") -> String:
	if !supplied.is_empty() && supplied != identity && !supplied.begins_with("item.") && !supplied.begins_with("fluid.") && !supplied.begins_with("block."):
		return supplied
	var base := identity.get_slice("#", 0)
	var words := base.get_slice(":", base.get_slice_count(":") - 1).replace("_", " ").capitalize()
	if identity.contains("#"):
		words += " · " + identity.get_slice("#", 1).left(6)
	return words.replace("Uu ", "UU ")


static func machine_name(identity: String, resources: Dictionary[String, String]) -> String:
	return readable_name(identity, resources.get("item:" + identity, ""))


static func number(value: float) -> String:
	if value != 0.0 && absf(value) < 0.001:
		return String.num_scientific(value)
	for unit: Array in [[1.0e15, "P"], [1.0e12, "T"], [1.0e9, "G"], [1.0e6, "M"], [1.0e3, "k"]]:
		if absf(value) >= unit[0]:
			return String.num(value / unit[0], 3) + " " + unit[1]
	return String.num(value, 3)


static func flow_rate(resource: String, rate: float) -> String:
	if resource == "energy:eu":
		return number(rate / 20.0) + " EU/t"
	return number(rate) + (" mB/s" if resource.begins_with("fluid:") else " /s")


static func loadout(configuration: Dictionary, resources: Dictionary[String, String]) -> String:
	var setup: Dictionary = configuration.get("setup", {})
	var count := int(setup.get("upgrade_count", 0))
	var text := "%d × %s per machine" % [count, machine_name(str(setup.get("upgrade", {}).get("id", "upgrade")), resources)] if count else "No upgrades"
	if setup.get("contained_count", 0):
		text += "\n%d × %s inside each array" % [setup.contained_count, machine_name(str(setup.get("contained_machine", "machine")), resources)]
	if setup.get("batch", 1) > 1:
		text += "\n%d operations per batch" % setup.batch
	return text


static func markup(value: String) -> String:
	return value.replace("[", "[lb]")


static func inspection(line: Dictionary, recipe: Dictionary, resources: Dictionary[String, String], startup: Dictionary, construction: Dictionary = {}) -> String:
	var configuration: Dictionary = line.get("configuration_details", {})
	var capacity: Dictionary = configuration.get("capacity", {})
	var title := readable_name(recipe.primary, recipe.get("name", ""))
	var text := "[font_size=20]%s[/font_size]\n\n[b]%d × %s[/b]\n%s\n" % [markup(title), int(line.machines), markup(machine_name(line.machine, resources)), markup(loadout(configuration, resources))]
	for section: String in ["Production", "Ingredients"]:
		text += "\n[b]%s[/b]\n" % section
		var flows: Array = line.outputs if section == "Production" else line.inputs
		if flows.is_empty():
			text += "None\n"
		for flow: Dictionary in flows:
			text += "%s · %s\n" % [markup(resources.get(flow.resource, readable_name(flow.resource))), flow_rate(flow.resource, flow.rate)]
	text += "\n[b]Capacity and power[/b]\n%s operations/s installed\n%s%% utilization\n%s EU/t sustained\n" % [number(line.capacity_per_second), String.num(line.utilization * 100, 1), number(line.power_eu_per_tick)]
	if capacity.has("ticks_per_batch"):
		var energy_resource: String = configuration.get("capacity_input", {}).get("machine", {}).get("energy_resource", "energy:eu")
		var energy_unit: String = "EU" if energy_resource == "energy:eu" else "mB " + resources.get(energy_resource, readable_name(energy_resource))
		text += "%s ticks per batch at full speed\n%s %s per operation\n%s %s/t peak per machine\n" % [number(capacity.ticks_per_batch), number(capacity.get("eu_per_operation", 0)), energy_unit, number(capacity.get("peak_eu_per_tick", 0)), energy_unit]
		if capacity.get("warmup_ticks") != null:
			text += "%s s to full-speed operation\n" % number(float(capacity.warmup_ticks) / 20.0)
	var discovery_ticks: float = configuration.get("startup_profile", {}).get("discovery_delay_ticks", 0)
	if discovery_ticks > 0:
		text += "Up to %s s for initial source discovery\n" % number(discovery_ticks / 20.0)
	var process: Dictionary = recipe.get("process", {})
	if !process.is_empty():
		text += "Recipe: %s ticks at %s EU/t before machine modifiers\n" % [number(process.get("duration_ticks", 0)), number(process.get("eu_per_tick", 0))]
	var structure: Dictionary = configuration.get("structure", {})
	if !configuration.get("build_requirements", []).is_empty():
		text += "\n[b]Build requirements per machine[/b]\n"
		for part: Dictionary in configuration.build_requirements:
			text += "%s × %s\n" % [number(part.amount), markup(resources.get(part.resource, readable_name(part.resource)))]
	if structure.get("status") == "unsupported":
		text += "Structure incomplete: " + markup(structure.reason) + "\n"
	elif structure.get("status") == "sized":
		text += "Hatches hold a full batch and meet the stated power limits. Selection minimizes hatch count; material-cost optimization is not included.\n"
	var key := String(line.recipe) + "|" + String(line.configuration)
	var stock_text := ""
	for stock: Dictionary in startup.get("resources", []):
		if key in stock.get("origins", []):
			stock_text += "%s · %s%s\n" % [markup(resources.get(stock.resource, readable_name(stock.resource))), number(stock.quantity), " mB" if String(stock.resource).begins_with("fluid:") else ""]
	if !stock_text.is_empty():
		text += "\n[b]Startup stocks[/b]\n" + stock_text + "Factory totals for resources used by this line. Conservative cold-start reserves include other consumers.\n"
	var assumptions: Array = configuration.get("assumptions", []).duplicate()
	if recipe.get("expected_yields", false):
		assumptions.append("Probabilistic outputs use expected yields. Actual deliveries vary.")
	for condition: Dictionary in recipe.get("conditions", []):
		assumptions.append("Required condition: " + JSON.stringify(condition))
	if !assumptions.is_empty():
		text += "\n[b]Assumptions and conditions[/b]\n"
		for assumption: String in assumptions:
			text += markup(assumption) + "\n"
	if !construction.is_empty():
		text += "\n[b]Factory construction estimate[/b]\n%s material cost units\n%s machine-seconds of construction work\n%s EU for construction\n" % [number(construction.material_cost), number(construction.work_seconds), number(construction.energy_eu)]
		text += "Whole recipe batches and purchased items for the factory. Random yields remain expected values.\n" if construction.method == "whole_batches" else "Unrounded material equivalents for the whole factory.\n"
		text += "These quantities are separate from operating flow rates.\n\n[b]Purchased construction supplies[/b]\n"
		for supply: Dictionary in construction.external:
			text += "%s × %s · %s cost each\n" % [number(supply.amount), markup(resources.get(supply.resource, readable_name(supply.resource))), number(supply.unit_cost)]
		text += "\n[b]Construction recipe work[/b]\n"
		for route: Dictionary in construction.routes:
			text += "%s operations · %s\n" % [number(route.operations), markup(route.get("name", route.recipe))]
		if !construction.get("tools", []).is_empty():
			text += "\n[b]Consumable construction tools[/b]\n"
			for tool: Dictionary in construction.tools:
				text += "%s × %s · %s crafts remain after this job\n" % [number(tool.count), markup(resources.get(tool.resource, readable_name(tool.resource))), number(tool.remaining_crafts)]
		for assumption: String in construction.assumptions:
			text += "\n" + markup(assumption) + "\n"
	text += "\n[b]Recipe source[/b]\n[font_size=12]%s\n%s[/font_size]" % [markup(recipe.get("source_id", recipe.id)), markup(recipe.get("origin", "Custom dataset"))]
	return text
