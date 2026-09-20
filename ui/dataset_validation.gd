class_name PlannerDatasetValidation
extends RefCounted


static func check(value: Variant) -> String:
	if !(value is Dictionary) || !_version(value.get("format")) || !(value.get("resources") is Array) || !(value.get("recipes") is Array):
		return "This file is not a supported planning dataset."
	var resources: Dictionary[String, bool] = {}
	for resource: Variant in value.resources:
		if !(resource is Dictionary) || !(resource.get("id") is String) || resource.id.is_empty():
			return "Every resource needs a nonempty text ID."
		if resources.has(resource.id):
			return "Duplicate resource ID: %s" % resource.id
		resources[resource.id] = true
	for field: String in ["machines", "upgrades"]:
		if !(value.get(field, []) is Array):
			return "The dataset's %s field must be a list." % field
		var ids: Dictionary[String, bool] = {}
		for record: Variant in value.get(field, []):
			if !(record is Dictionary) || !(record.get("id") is String) || record.id.is_empty():
				return "Every %s entry needs a text ID." % field
			if ids.has(record.id):
				return "Duplicate %s ID: %s" % [field, record.id]
			ids[record.id] = true
	if !_string_list(value.get("default_machines", [])):
		return "Default machines must be a list of text IDs."
	var recipes: Dictionary[String, bool] = {}
	for recipe: Variant in value.recipes:
		if !(recipe is Dictionary) || !(recipe.get("id") is String) || recipe.id.is_empty():
			return "Every recipe needs a nonempty text ID."
		if recipes.has(recipe.id):
			return "Duplicate recipe ID: %s" % recipe.id
		recipes[recipe.id] = true
		if recipe.has("unsupported") && !(recipe.unsupported is String):
			return "Recipe %s needs a text explanation of unsupported behavior." % recipe.id
		if recipe.has("process") && !(recipe.process is Dictionary):
			return "Recipe %s has an invalid process." % recipe.id
		if !(recipe.get("primary") is String) || !resources.has(recipe.primary):
			return "Recipe %s has an unknown primary output." % recipe.id
		for direction: String in ["inputs", "outputs"]:
			if !(recipe.get(direction) is Array):
				return "Recipe %s needs an %s list." % [recipe.id, direction]
			for flow: Variant in recipe[direction]:
				if !(flow is Dictionary) || !_positive(flow.get("amount")):
					return "Recipe %s has an invalid resource quantity." % recipe.id
				var choices: Variant = flow.get("choices", [flow.get("resource")])
				if !(choices is Array) || choices.is_empty():
					return "Recipe %s has an empty ingredient choice." % recipe.id
				for resource: Variant in choices:
					if !(resource is String) || !resources.has(resource):
						return "Recipe %s references an unknown resource." % recipe.id
				if direction == "outputs" && !(flow.get("resource") is String):
					return "Recipe %s needs concrete output resources." % recipe.id
		if recipe.outputs.is_empty() || !(recipe.get("configurations") is Array):
			return "Recipe %s needs outputs and a configuration list." % recipe.id
		for configuration: Variant in recipe.configurations:
			if !(configuration is Dictionary) || !(configuration.get("id") is String) || !(configuration.get("machine") is String) || !_positive(configuration.get("operations_per_second")):
				return "Recipe %s has an invalid machine configuration." % recipe.id
	return ""


static func check_plan(value: Variant) -> String:
	if !(value is Dictionary) || str(value.get("format")) != "factory-plan" || !_version(value.get("version")):
		return "This file is not a supported factory plan."
	var error := check(value.get("dataset"))
	if !error.is_empty():
		return error
	if value.get("dataset_identity") != value.dataset.get("identity", "custom"):
		return "The plan's dataset identity does not match its embedded data."
	if !(value.get("request") is Dictionary) || !(value.request.get("goals") is Array):
		return "The plan has no valid goal list."
	for field: String in ["available_machines", "disabled_machines", "available_upgrades", "disabled_upgrades", "disabled_recipes", "obtained_resources", "available_dimensions", "available_biomes"]:
		if !_string_list(value.request.get(field, [])):
			return "The plan's %s field must be a list of text IDs." % field
	for field: String in ["weights", "routes", "configurations", "machine_setups", "ingredients", "catalysts", "installed", "limits", "dispatch"]:
		if !(value.request.get(field, {}) is Dictionary):
			return "The plan's %s field must be an object." % field
	if !(value.request.get("external", []) is Array):
		return "External supplies must be a list."
	for supply: Variant in value.request.get("external", []):
		if !(supply is Dictionary) || !(supply.get("resource") is String):
			return "Every external supply needs a resource ID."
		for field: String in ["cost", "limit"]:
			if supply.has(field) && !_nonnegative(supply[field]):
				return "External supply %s must be nonnegative." % field
	for field: String in ["reserve_fraction", "overhead_eu_per_tick"]:
		if value.request.has(field) && !_nonnegative(value.request[field]):
			return "The plan's %s field must be nonnegative." % field
	for goal: Variant in value.request.goals:
		if !(goal is Dictionary) || !(goal.get("resource") is String):
			return "The plan contains an invalid goal."
		if !(goal.get("kind", "rate") is String):
			return "The goal type must be text."
		var kind: String = goal.get("kind", "rate")
		if !kind in ["rate", "capacity", "quantity"]:
			return "The plan contains an unknown goal type."
		if kind == "capacity":
			if !(goal.get("recipe") is String) || !(goal.get("configuration") is String) || !_positive(goal.get("machines")) || goal.machines != floorf(goal.machines):
				return "A capacity goal needs a recipe, configuration, and whole-machine count."
		elif !_positive(goal.get("rate")):
			return "The goal rate must be positive."
		if kind == "quantity" && !_quantity(goal.get("quantity")):
			return "The production quantity must be positive."
		if !value.dataset.resources.any(func(resource: Dictionary) -> bool: return resource.id == goal.resource):
			return "The plan requests an unknown resource: %s" % goal.resource
	for field: String in ["positions", "groups"]:
		if !(value.get(field, {}) is Dictionary):
			return "The plan's %s field must be an object." % field
	for point: Variant in value.get("positions", {}).values():
		if !_coordinates(point, 2):
			return "The plan contains an invalid node position."
	for group: Variant in value.get("groups", {}).values():
		if !(group is Dictionary) || !(group.get("title") is String) || !_coordinates(group.get("rect"), 4):
			return "The plan contains an invalid group boundary."
		if group.rect[2] <= 0 || group.rect[3] <= 0:
			return "Group boundaries must have positive width and height."
	return ""


static func _positive(value: Variant) -> bool:
	return (value is float || value is int) && is_finite(float(value)) && value > 0 && value <= 9007199254740991.0


static func _quantity(value: Variant) -> bool:
	if !(value is String):
		return _positive(value)
	if value.length() > 2000:
		return false
	var expression := RegEx.new()
	expression.compile("^\\+?(\\d+)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$")
	var matched := expression.search(value.strip_edges())
	if !matched:
		return false
	var digits := matched.get_string(1) + matched.get_string(2)
	var exponent := matched.get_string(3)
	if digits.length() > 1000 || exponent.length() > 5 || digits.replace("0", "").is_empty():
		return false
	return absi(exponent.to_int() - matched.get_string(2).length()) <= 1000


static func _nonnegative(value: Variant) -> bool:
	return (value is float || value is int) && is_finite(float(value)) && value >= 0 && value <= 9007199254740991.0


static func _version(value: Variant) -> bool:
	return (value is float || value is int) && value == 1


static func _string_list(value: Variant) -> bool:
	return value is Array && value.all(func(entry: Variant) -> bool: return entry is String)


static func _coordinates(value: Variant, count: int) -> bool:
	if !(value is Array) || value.size() != count:
		return false
	for coordinate: Variant in value:
		if !(coordinate is float || coordinate is int) || !is_finite(float(coordinate)) || absf(float(coordinate)) > 1000000000:
			return false
	return true
