class_name PlannerFeedback
extends Node

var enabled := false
var _last_hover := 0


func bind_controls(root: Node) -> void:
	for button: BaseButton in root.find_children("*", "BaseButton", true, false):
		button.pressed.connect(confirm)
		button.mouse_entered.connect(hover)
		button.focus_entered.connect(hover)
	for window: Window in root.find_children("*", "Window", true, false):
		if window.has_signal("canceled"):
			window.connect("canceled", cancel)


func confirm() -> void:
	if enabled:
		%ConfirmTone.pitch_scale = randf_range(0.98, 1.02)
		%ConfirmTone.play()


func hover() -> void:
	if enabled && Time.get_ticks_msec() - _last_hover > 100:
		_last_hover = Time.get_ticks_msec()
		%HoverTone.play()


func cancel() -> void:
	if enabled:
		%CancelTone.play()


func error() -> void:
	if enabled:
		%ErrorTone.play()
