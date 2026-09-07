"""Analysis-only quiet-voice correction; source audio and sample positions stay intact."""
import numpy as np


def condition_voice(pcm, rate):
    source = np.asarray(pcm, dtype=np.float32)
    dc = float(np.mean(source))
    centered = source - dc
    frame = max(1, round(rate * .02))
    count = len(source) // frame
    if count == 0:
        return centered
    levels = np.sqrt(np.mean(centered[:count * frame].reshape(count, frame) ** 2, axis=1))
    level = float(np.percentile(levels, 80))
    # A brief idea surrounded by silence still needs a useful level estimate.
    if level < 1e-5:
        level = float(np.max(levels))
    # Preserve healthy takes exactly; global normalization moved good boundaries.
    if level >= .02 and abs(dc) < .003:
        return source
    if level < 1e-5:
        return centered
    # Move a weak voice into the models' useful range before fixed voicing gates.
    # Bound gain and leave headroom. No spectral gate, time shift or hard clipping.
    gain = min(40, .04 / level) if level < .02 else 1
    gain = min(gain, .98 / max(.001, float(np.max(np.abs(centered)))))
    return (centered * gain).astype(np.float32)
