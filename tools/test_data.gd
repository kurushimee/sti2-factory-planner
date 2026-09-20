extends SceneTree


func _init() -> void:
	var dataset: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/example.json"))
	assert(PlannerDatasetValidation.check(dataset).is_empty())
	assert(!PlannerDatasetValidation.check({"format": "factory-plan"}).is_empty())
	assert(!PlannerDatasetValidation.check_plan({"format": 1}).is_empty())
	var malformed := dataset.duplicate(true)
	malformed.recipes[0].configurations[0].operations_per_second = -1
	assert(!PlannerDatasetValidation.check(malformed).is_empty())
	malformed = dataset.duplicate(true)
	malformed.resources.append(malformed.resources[0])
	assert(!PlannerDatasetValidation.check(malformed).is_empty())
	var plan := {"format": "factory-plan", "version": 1, "dataset": dataset, "dataset_identity": "example:1", "request": {"goals": [{"resource": "ore", "rate": 1}]}, "positions": {}, "groups": {}}
	assert(PlannerDatasetValidation.check_plan(plan).is_empty())
	for invalid: Variant in [null, "wrong", 2, {}]:
		plan.request.available_machines = invalid
		assert(!PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.request.erase("available_machines")
	plan.request.external = [{"resource": "ore", "limit": -1}]
	assert(!PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.request.erase("external")
	plan.request.goals[0] = {"kind": "capacity", "resource": "ore", "recipe": "mine", "configuration": "miner", "machines": 2}
	assert(PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.request.goals[0].machines = 1.5
	assert(!PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.request.goals[0] = {"kind": "quantity", "resource": "ore", "rate": 2, "quantity": 1000000000000}
	assert(PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.positions.test = [0, "wrong"]
	assert(!PlannerDatasetValidation.check_plan(plan).is_empty())
	plan.positions.clear()
	plan.dataset_identity = "different"
	assert(!PlannerDatasetValidation.check_plan(plan).is_empty())
	print("Dataset and plan validation checks passed.")
	quit()
