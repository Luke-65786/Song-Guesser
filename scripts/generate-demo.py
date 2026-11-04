"""Generate five original, offline demo loops using only the Python standard library."""
import math
from pathlib import Path
import random
import struct
import wave

DEST = Path(__file__).resolve().parent.parent / "public" / "audio"
RATE = 22050
DURATION = 18
TAU = math.tau

TRACKS = [
    ("neon-avenue", 124, [69, 72, 76, 72, 67, 72, 74, 76, 69, 72, 79, 76, 74, 72, 67, 64], [45, 41, 48, 43], "synth"),
    ("sunday-somewhere", 82, [64, 67, 71, 74, 71, 67, 66, 62, 64, 71, 69, 67, 66, 62, 59, 62], [40, 45, 38, 43], "soft"),
    ("after-hours", 132, [57, 57, 69, 64, 57, 67, 64, 60, 57, 57, 72, 69, 67, 64, 60, 64], [33, 33, 41, 40], "dance"),
    ("golden-state", 108, [67, 71, 74, 79, 74, 71, 69, 67, 64, 67, 72, 76, 74, 72, 71, 67], [43, 38, 40, 36], "pluck"),
    ("paper-planes", 94, [72, 79, 76, 74, 72, 67, 69, 76, 74, 72, 69, 67, 64, 67, 69, 72], [48, 45, 41, 43], "bell"),
]

def frequency(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def make_track(slug, bpm, notes, bass, tone):
    randomizer = random.Random(slug)
    beat = 60 / bpm
    frames = bytearray()
    for frame in range(RATE * DURATION):
        t = frame / RATE
        step = int(t / (beat / 2))
        age = t % (beat / 2)
        f = frequency(notes[step % len(notes)])
        phase = TAU * f * age
        envelope = min(1, age * 170) * math.exp(-age * (9 if tone in ("pluck", "bell") else 5))
        lead = math.sin(phase) + (0.35 if tone == "synth" else 0.15) * math.sin(2 * phase)
        if tone == "bell":
            lead += 0.3 * math.sin(phase * 3) * math.exp(-age * 15)
        if tone == "dance":
            lead += 0.2 * math.sin(phase * 4)
        base = frequency(bass[(int(t / beat) // 4) % len(bass)])
        bass_age = t % beat
        low = math.sin(TAU * base * t) * math.exp(-bass_age * 3) * .20
        kick = math.sin(TAU * (48 * bass_age + 8 * (1 - math.exp(-bass_age * 24)))) * math.exp(-bass_age * 27) * .30
        hat_age = t % (beat / 2)
        hat = (randomizer.random() * 2 - 1) * math.exp(-hat_age * 120) * .06
        snare = 0
        if int(t / beat) % 2:
            snare = (randomizer.random() * 2 - 1) * math.exp(-bass_age * 32) * .10
        fade = min(1, t * 40, (DURATION - t) * 2)
        sample = (lead * envelope * .20 + low + kick + hat + snare) * fade
        frames.extend(struct.pack('<h', int(max(-1, min(1, sample)) * 26000)))
    with wave.open(str(DEST / (slug + '.wav')), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(frames)
    print('Created', slug)

if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    for track in TRACKS:
        make_track(*track)
