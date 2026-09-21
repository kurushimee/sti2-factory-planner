class_name PlannerJson
extends RefCounted

static var _decimal_numbers: RegEx


static func parse(text: String) -> Variant:
	# Godot can lose precision or magnitude when parsing long decimal fractions.
	# Scientific notation preserves those significant digits; quoted strings stay untouched.
	if _decimal_numbers == null:
		_decimal_numbers = RegEx.new()
		_decimal_numbers.compile('"(?:[^"\\\\]|\\\\.)*"(*SKIP)(*F)|(?<number>-?(?<integer>0|[1-9][0-9]*)\\.(?<fraction>[0-9]+)(?:[eE](?<exponent>[+-]?[0-9]+))?)')
	var bytes := PackedByteArray()
	var cursor := 0
	var matched := _decimal_numbers.search(text)
	while matched:
		bytes.append_array(text.substr(cursor, matched.get_start() - cursor).to_utf8_buffer())
		var digits := matched.get_string("integer") + matched.get_string("fraction")
		var leading := 0
		while leading < digits.length() - 1 && digits[leading] == "0":
			leading += 1
		var exponent := matched.get_string("exponent").to_int() + matched.get_string("integer").length() - leading - 1
		digits = digits.substr(leading)
		var sign := "-" if matched.get_string("number").begins_with("-") else ""
		var mantissa := digits.left(1) + ("." + digits.substr(1) if digits.length() > 1 else "")
		bytes.append_array((sign + mantissa + "e" + str(exponent)).to_utf8_buffer())
		cursor = matched.get_end()
		matched = _decimal_numbers.search(text, cursor)
	if cursor == 0:
		return JSON.parse_string(text)
	bytes.append_array(text.substr(cursor).to_utf8_buffer())
	var normalized := bytes.get_string_from_utf8()
	bytes.clear()
	text = ""
	return JSON.parse_string(normalized)
