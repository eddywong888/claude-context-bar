"""Builds the piano-like note clips in sounds/piano/ (C4 to C5, the white keys).

Each note is synthesised from scratch: a few harmonics, slightly stretched like a
real string, each fading at its own rate, with a soft hammer tap at the start.

    python3 scripts/make-notes.py
"""

import math
import os
import random
import struct
import wave

RATE = 22050
SECONDS = 1.3
NOTES = {'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88, 'C5': 523.25}
# Harmonic number, loudness, and how fast it fades (higher harmonics fade sooner).
PARTIALS = [(1, 1.0, 2.2), (2, 0.55, 3.0), (3, 0.28, 4.2), (4, 0.16, 5.5), (5, 0.08, 7.0), (6, 0.05, 8.5), (7, 0.025, 10.0)]
STRETCH = 0.0004


def note(freq: float) -> list[float]:
    rng = random.Random(int(freq * 100))
    n = int(RATE * SECONDS)
    out = []
    for i in range(n):
        t = i / RATE
        attack = min(1.0, t / 0.004)
        release = min(1.0, (SECONDS - t) / 0.08)
        s = 0.0
        for k, amp, fade in PARTIALS:
            f = freq * k * math.sqrt(1 + STRETCH * k * k)
            if f >= RATE / 2:
                continue
            s += amp * math.exp(-fade * t) * math.sin(2 * math.pi * f * t)
        tap = rng.uniform(-1, 1) * 0.12 * math.exp(-t / 0.006)
        out.append((s + tap) * attack * release)
    return out


def write(path: str, samples: list[float]) -> None:
    peak = max(abs(s) for s in samples) or 1.0
    frames = b''.join(struct.pack('<h', int(s / peak * 0.8 * 32767)) for s in samples)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames)


if __name__ == '__main__':
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds', 'piano')
    os.makedirs(here, exist_ok=True)
    for name, freq in NOTES.items():
        write(os.path.join(here, f'{name}.wav'), note(freq))
        print(f'sounds/piano/{name}.wav')
