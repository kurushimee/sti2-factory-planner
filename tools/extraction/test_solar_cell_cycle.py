"""Check exact cell wear and expiry energy against short independent cycles."""

import unittest

from solar_cell_cycle import cell_cycle
from verify_solar import ACTIVE_TICKS, clear_day_power, clear_efficiency


def simulate_day_cycles(power, active_positions, lifetime, wear_every, days):
    age = active_tick = cells = energy = 0
    daily = []
    for _ in range(days):
        produced = 0
        for position in active_positions:
            active_tick += 1
            if active_tick % wear_every == 0:
                age += 1
            if age == lifetime:
                cells += 1
                age = 0
            else:
                produced += power[position]
        daily.append(produced)
        energy += produced
    return cells, energy, daily


class SolarCellCycleTest(unittest.TestCase):
    def test_short_dry_and_water_cycles(self):
        power = [0, 1, 2, 3, 0]
        active = [1, 2, 3]
        for wear_every in (1, 2):
            rule = cell_cycle(power, active, 4, wear_every)
            cells, energy, daily = simulate_day_cycles(power, active, 4, wear_every,
                                                       rule["repeating_clear_days"])
            self.assertEqual(cells, rule["cells_used_per_repeating_cycle"])
            self.assertEqual(energy, rule["energy_eu_per_repeating_cycle"])
            self.assertEqual(min(daily), rule["minimum_energy_eu_in_one_clear_day"])

    def test_released_solar_rules_have_exact_long_cycle(self):
        active = [tick for tick in range(24000) if clear_efficiency(tick) > 0]
        self.assertEqual(len(active), ACTIVE_TICKS)
        for peak in (32, 128, 512):
            for water in (False, True):
                power = clear_day_power(peak, water)
                rule = cell_cycle(power, active, 12000, 2 if water else 1)
                self.assertEqual(rule["cells_used_per_repeating_cycle"], 11999)
                self.assertEqual(rule["repeating_clear_days"], 24000 if water else 12000)
                self.assertEqual(rule["energy_eu_per_repeating_cycle"],
                                 sum(power) * (rule["repeating_clear_days"] - 1))

    def test_nonuniform_expiry_positions_need_another_adapter(self):
        with self.assertRaisesRegex(ValueError, "phase"):
            cell_cycle([1, 2, 3, 4], [0, 1, 2, 3], 4, 1)


if __name__ == "__main__":
    unittest.main()
