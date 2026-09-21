class_name PlannerJson
extends RefCounted

static var _small_numbers: RegEx


static func parse(text: String) -> Variant:
	# Godot's decimal parser counts leading fractional zeros against its precision.
	# Scientific notation preserves those significant digits; quoted strings stay untouched.
	if _small_numbers == null:
		_small_numbers = RegEx.new()
		_small_numbers.compile('"(?:[^"\\\\]|\\\\.)*"(*SKIP)(*F)|(?<number>-?0\\.(?<zeros>0+)(?<digits>[1-9][0-9]*)(?:[eE](?<exponent>[+-]?[0-9]+))?)')
	var bytes := PackedByteArray()
	var cursor := 0
	for matched: RegExMatch in _small_numbers.search_all(text):
		bytes.append_array(text.substr(cursor, matched.get_start() - cursor).to_utf8_buffer())
		var digits := matched.get_string("digits")
		var exponent := matched.get_string("exponent").to_int() - matched.get_string("zeros").length() - 1
		var sign := "-" if matched.get_string("number").begins_with("-") else ""
		var mantissa := digits.left(1) + ("." + digits.substr(1) if digits.length() > 1 else "")
		bytes.append_array((sign + mantissa + "e" + str(exponent)).to_utf8_buffer())
		cursor = matched.get_end()
	if cursor == 0:
		return JSON.parse_string(text)
	bytes.append_array(text.substr(cursor).to_utf8_buffer())
	var normalized := bytes.get_string_from_utf8()
	bytes.clear()
	text = ""
	return JSON.parse_string(normalized)
