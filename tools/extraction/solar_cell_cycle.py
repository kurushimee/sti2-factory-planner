"""Derive clear-day photovoltaic cell use from the loaded wear rule."""

from math import gcd


def cell_cycle(power, active_positions, cell_lifetime, wear_every):
    if (not power or not active_positions or cell_lifetime <= 0 or wear_every <= 0
            or any(not isinstance(value, int) or value < 0 for value in power)
            or any(not isinstance(position, int) or position < 0 or position >= len(power)
                   for position in active_positions)
            or len(set(active_positions)) != len(active_positions)
            or any(value and index not in active_positions for index, value in enumerate(power))):
        raise ValueError("The photovoltaic profile or wear rule is invalid.")
    active_ticks = len(active_positions)
    ticks_per_cell = cell_lifetime * wear_every
    if gcd(active_ticks, ticks_per_cell) != 1:
        raise ValueError("The cell-expiry phase needs a separate exact cycle adapter.")
    daily_energy = sum(power)
    peak_loss = max(power[position] for position in active_positions)
    return {
        "kind": "uniform_cell_expiry",
        "active_ticks_per_clear_day": active_ticks,
        "cell_lifetime_wear_ticks": cell_lifetime,
        "wear_every_active_ticks": wear_every,
        "active_ticks_per_cell": ticks_per_cell,
        "repeating_clear_days": ticks_per_cell,
        "cells_used_per_repeating_cycle": active_ticks,
        "energy_eu_per_repeating_cycle": daily_energy * (ticks_per_cell - 1),
        "energy_eu_without_expiry_per_day": daily_energy,
        "minimum_energy_eu_in_one_clear_day": daily_energy - peak_loss,
        "maximum_cell_use_in_one_clear_day": 1,
    }
