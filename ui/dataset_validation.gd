class_name PlannerDatasetValidation
extends RefCounted


static func check(value: Variant) -> String:
	if !(value is Dictionary) || value.get("format") != 1 || !(value.get("resources") is Array) || !(value.get("recipes") is Array):
		return "This file is not a supported planning dataset."
	var resources: Dictionary[String, bool] = {}
	for resource: Variant in value.resources:
		if !(resource is Dictionary) || !(resource.get("id") is String) || resource.id.is_empty():
			return "Every resource needs a nonempty text ID."
		if resources.has(resource.id):
			return "Duplicate resource ID: %s" % resource.id
		resources[resource.id] = true
	var recipes: Dictionary[String, bool] = {}
	for recipe: Variant in value.recipes:
		if !(recipe is Dictionary) || !(recipe.get("id") is String) || recipe.id.is_empty():
			return "Every recipe needs a nonempty text ID."
		if recipes.has(recipe.id):
			return "Duplicate recipe ID: %s" % recipe.id
		recipes[recipe.id] = true
		if !(recipe.get("primary") is String) || !resources.has(recipe.primary):
			return "Recipe %s has an unknown primary output." % recipe.id
		for direction: String in ["inputs", "outputs"]:
			if !(recipe.get(direction) is Array):
				return "Recipe %s needs an %s list." % [recipe.id, direction]
			for flow: Variant in recipe[direction]:
				if !(flow is Dictionary) || !(flow.get("resource") is String) || !resources.has(flow.resource) || !_positive(flow.get("amount")):
					return "Recipe %s has an invalid resource quantity." % recipe.id
		if recipe.outputs.is_empty() || !(recipe.get("configurations") is Array):
			return "Recipe %s needs outputs and a configuration list." % recipe.id
		for configuration: Variant in recipe.configurations:
			if !(configuration is Dictionary) || !(configuration.get("id") is String) || !(configuration.get("machine") is String) || !_positive(configuration.get("operations_per_second")):
				return "Recipe %s has an invalid machine configuration." % recipe.id
	return ""


static func check_plan(value: Variant) -> String:
	if !(value is Dictionary) || value.get("format") != "factory-plan" || value.get("version") != 1:
		return "This file is not a supported factory plan."
	var error := check(value.get("dataset"))
	if !error.is_empty():
		return error
	if value.get("dataset_identity") != value.dataset.get("identity", "custom"):
		return "The plan's dataset identity does not match its embedded data."
	if !(value.get("request") is Dictionary) || !(value.request.get("goals") is Array):
		return "The plan has no valid goal list."
	for goal: Variant in value.request.goals:
		if !(goal is Dictionary) || !(goal.get("resource") is String) || !_positive(goal.get("rate")):
			return "The plan contains an invalid goal."
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


static func _coordinates(value: Variant, count: int) -> bool:
	if !(value is Array) || value.size() != count:
		return false
	for coordinate: Variant in value:
		if !(coordinate is float || coordinate is int) || !is_finite(float(coordinate)) || absf(float(coordinate)) > 1000000000:
			return false
	return true
