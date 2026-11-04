#!/usr/bin/env python3
"""Control de calidad de la locución: transcribe WAVs con Whisper (pronunciación/inteligibilidad)."""
import subprocess, sys, numpy as np
from faster_whisper import WhisperModel
m = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=2)
for f in sys.argv[1:]:
    a = np.frombuffer(subprocess.check_output(['ffmpeg', '-loglevel', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']), np.float32)
    segs, _ = m.transcribe(a, language="es", beam_size=5)
    print(f, "|", " ".join(s.text.strip() for s in segs), flush=True)
