"""Whole-take room-level evidence. Keep in sync with lib/music/voice-activity.ts."""
import numpy as np


def voice_activity(levels):
    levels = np.asarray(levels)
    ordered = np.sort(levels[np.isfinite(levels)])
    if not len(ordered):
        return np.zeros(len(levels), dtype=bool)
    quiet = ordered[int(len(ordered) * .15)]
    voice = ordered[int(len(ordered) * .85)]
    threshold = quiet * 2.5 if voice > quiet * 4 else 0
    return np.isfinite(levels) & (levels >= threshold)
