"""Generate the shared desktop workspace theme from a small palette."""

from pathlib import Path


def color(value):
    values = [int(value[index:index + 2], 16) / 255 for index in (0, 2, 4)]
    return "Color(" + ", ".join(f"{value:.5f}" for value in values) + ", 1)"


styles = {
    "surface": ("20292d", "354249", 0),
    "button": ("2d393e", "46565d", 1),
    "hover": ("3d4d53", "7f969f", 1),
    "pressed": ("485343", "d5a36a", 1),
    "disabled": ("232c30", "354249", 1),
    "focus": ("2d393e", "edc796", 2),
    "field": ("141d21", "46565d", 1),
    "graph": ("141d21", "354249", 0),
    "node": ("253238", "4a606a", 1),
    "selected": ("2c3d44", "d5a36a", 2),
    "title": ("33464e", "4a606a", 1),
}
parts = ['[gd_resource type="Theme" load_steps=13 format=3]',
         '[ext_resource type="FontFile" path="res://ui/fonts/inter.ttf" id="1"]']
for name, (background, border, width) in styles.items():
    parts.append(f'[sub_resource type="StyleBoxFlat" id="{name}"]\nbg_color = {color(background)}\nborder_color = {color(border)}')
    for side in ("left", "right", "top", "bottom"):
        parts.append(f'border_width_{side} = {width}\ncontent_margin_{side} = {12 if side in ("left", "right") else 8}.0')
    for corner in ("top_left", "top_right", "bottom_left", "bottom_right"):
        parts.append(f'corner_radius_{corner} = 5')
parts.append('[resource]\ndefault_font = ExtResource("1")\ndefault_font_size = 15')
for control in ("Button", "OptionButton", "MenuButton", "CheckButton", "CheckBox"):
    for state, style in {"normal": "button", "hover": "hover", "pressed": "pressed", "disabled": "disabled", "focus": "focus", "hover_pressed": "pressed"}.items():
        parts.append(f'{control}/styles/{state} = SubResource("{style}")')
    for state in ("font_color", "font_hover_color", "font_pressed_color", "font_focus_color"):
        parts.append(f'{control}/colors/{state} = {color("edf0eb")}')
    parts.append(f'{control}/colors/font_disabled_color = {color("a1afb5")}')
for control in ("Label", "RichTextLabel", "LineEdit", "SpinBox", "ItemList", "PopupMenu"):
    parts.append(f'{control}/colors/font_color = {color("edf0eb")}')
parts += ['TitleLabel/base_type = &"Label"', 'TitleLabel/font_sizes/font_size = 23',
          'SectionLabel/base_type = &"Label"', 'SectionLabel/font_sizes/font_size = 18',
          'MutedLabel/base_type = &"Label"', 'MutedLabel/font_sizes/font_size = 13',
          f'MutedLabel/colors/font_color = {color("b0bfc4")}',
          'PanelContainer/styles/panel = SubResource("surface")',
          'PopupPanel/styles/panel = SubResource("surface")',
          'PopupMenu/styles/panel = SubResource("surface")',
          'PopupMenu/styles/hover = SubResource("hover")',
          'LineEdit/styles/normal = SubResource("field")',
          'LineEdit/styles/focus = SubResource("focus")',
          'ItemList/styles/panel = SubResource("field")',
          'ItemList/styles/selected = SubResource("pressed")',
          'ItemList/styles/selected_focus = SubResource("selected")',
          'ItemList/styles/focus = SubResource("focus")',
          'ItemList/constants/v_separation = 12',
          'GraphEdit/styles/panel = SubResource("graph")',
          f'GraphEdit/colors/grid_minor = {color("1d292e")}',
          f'GraphEdit/colors/grid_major = {color("29393f")}',
          'GraphNode/styles/panel = SubResource("node")',
          'GraphNode/styles/panel_selected = SubResource("selected")',
          'GraphNode/styles/titlebar = SubResource("title")',
          'GraphNode/styles/titlebar_selected = SubResource("pressed")',
          'GraphNode/font_sizes/title_font_size = 16',
          'GraphFrame/styles/panel = SubResource("surface")',
          'GraphFrame/styles/panel_selected = SubResource("selected")',
          'GraphFrame/styles/titlebar = SubResource("title")',
          'GraphFrame/styles/titlebar_selected = SubResource("pressed")',
          'AcceptDialog/styles/panel = SubResource("surface")',
          'VBoxContainer/constants/separation = 10', 'HBoxContainer/constants/separation = 10',
          'HSeparator/constants/separation = 10',
          'TooltipPanel/styles/panel = SubResource("surface")',
          'HScrollBar/styles/scroll = SubResource("field")',
          'HScrollBar/styles/grabber = SubResource("button")',
          'HScrollBar/styles/grabber_highlight = SubResource("hover")',
          'VScrollBar/styles/scroll = SubResource("field")',
          'VScrollBar/styles/grabber = SubResource("button")',
          'VScrollBar/styles/grabber_highlight = SubResource("hover")']
Path("ui/theme.tres").write_text("\n\n".join(parts) + "\n", encoding="utf-8")
