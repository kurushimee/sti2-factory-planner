"""Generate the planner's original, quiet interface tones."""

import math
from pathlib import Path
import struct
import wave


destination = Path(__file__).resolve().parents[1] / "ui/audio"
destination.mkdir(exist_ok=True)
for name, frequency, duration in (("hover", 600, 0.018), ("confirm", 880, 0.045),
                                  ("cancel", 420, 0.035), ("error", 220, 0.09)):
    rate = 22050
    samples = []
    for index in range(round(rate * duration)):
        time = index / rate
        envelope = min(1, time / 0.003) * (1 - time / duration) ** 3
        samples.append(round(10000 * envelope * math.sin(2 * math.pi * frequency * time)))
    with wave.open(str(destination / (name + ".wav")), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(struct.pack("<" + "h" * len(samples), *samples))
