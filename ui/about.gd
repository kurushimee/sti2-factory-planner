class_name PlannerAbout
extends AcceptDialog

var _documents: Array[String] = []


func _ready() -> void:
	%AboutSection.item_selected.connect(_show_document)
	var controls: Array[Control] = [%AboutSection, %AboutText, get_ok_button()]
	for index: int in controls.size():
		controls[index].focus_next = controls[index].get_path_to(controls[(index + 1) % controls.size()])
		controls[index].focus_previous = controls[index].get_path_to(controls[(index + controls.size() - 1) % controls.size()])
		controls[index].focus_neighbor_right = controls[index].focus_next
		controls[index].focus_neighbor_left = controls[index].focus_previous


func open_about(dataset: Dictionary, reduced_motion: bool) -> void:
	%AboutSection.clear()
	_documents.clear()
	_add_document("About this planner", "Factory planner\n\nAn independent planning tool for StaTech Industry 2 and custom recipe datasets.\n\nThis is an unofficial Minecraft companion application. It is not approved by or associated with Mojang or Microsoft.\n\nDevelopment build: required mechanics and release checks are still in progress.\n\nLoaded dataset: %s\n%d planning routes · %d resources\n%d source entries still need adapters\n\nProject and issue tracker:\nhttps://github.com/kurushimee/sti2-factory-planner\n\nGodot %s · HiGHS 1.15.3 · fflate 0.8.3 · ELK.js 0.12.0\nInterface font: Inter, under the SIL Open Font License.\n\nChoose a section above to read source attribution and license notices." % [dataset.get("name", "Custom dataset"), dataset.get("recipes", []).size(), dataset.get("resources", []).size(), dataset.get("unsupported_entries", []).size(), Engine.get_version_info().string])
	_add_document("StaTech data attribution", FileAccess.get_file_as_string("res://data/ATTRIBUTION.md"))
	_add_document("Bundled dataset manifest", FileAccess.get_file_as_string("res://data/provenance/distribution-manifest.json"))
	_add_document("Mod source declarations", FileAccess.get_file_as_string("res://data/provenance/distribution-audit.json"))
	_add_document("Loaded mod versions", JSON.stringify(dataset.get("loaded_mods", []), "  "))
	_add_document("Godot engine license", Engine.get_license_text())
	_add_document("Godot third-party notices", JSON.stringify(Engine.get_copyright_info(), "  ") + "\n\n" + JSON.stringify(Engine.get_license_info(), "  "))
	_add_document("Inter font license", FileAccess.get_file_as_string("res://ui/fonts/OFL.txt"))
	for filename: String in DirAccess.get_files_at("res://data/licenses"):
		if filename.ends_with(".txt"):
			_add_document(filename.trim_suffix(".txt") + " license", FileAccess.get_file_as_string("res://data/licenses/" + filename))
	_show_document(0)
	popup_centered(Vector2i(900, 650))
	%AboutSection.grab_focus()
	if !reduced_motion:
		%AboutContent.modulate.a = 0.0
		create_tween().tween_property(%AboutContent, "modulate:a", 1.0, 0.15)


func _add_document(title_text: String, content: String) -> void:
	%AboutSection.add_item(title_text)
	_documents.append(content)


func _show_document(index: int) -> void:
	%AboutText.text = _documents[index]
	%AboutText.scroll_to_line(0)
