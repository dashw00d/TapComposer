"""Align learned note regions to supported acoustic pitch, keeping the capture clock."""
import numpy as np
from voice_activity import voice_activity
from voice_articulation import repeated_hum_attacks, split_hum_attacks, annotate_hum_drift


def decode_notes(pitches, confidence, levels, hop, boundaries, duration):
    pitches = np.array(pitches, dtype=float, copy=True)
    pitches[~voice_activity(levels)] = np.nan
    events = []
    # Learned boundaries can miss repeated hums. A sustained unvoiced interval
    # is independent evidence of a rest, even when the same pitch resumes.
    rests = []
    i = 0
    while i < len(pitches):
        if np.isfinite(pitches[i]):
            i += 1
            continue
        start = i
        while i < len(pitches) and not np.isfinite(pitches[i]):
            i += 1
        if (i - start) * hop >= .06:
            rests.extend([start * hop, min(duration, i * hop)])
    cuts = sorted(set([0.0, *[float(b) for b in [*boundaries, *rests] if 0 < b < duration], duration]))
    for start, end in zip(cuts, cuts[1:]):
        begin = round(start / hop)
        finish = min(len(pitches), round(end / hop))
        contour = pitches[begin:finish]
        voiced = contour[np.isfinite(contour)]
        if len(voiced) * hop < .04:
            continue
        target = np.median(voiced)
        runs = []
        a = last = -1
        for j, pitch in enumerate(contour):
            if np.isfinite(pitch) and abs(pitch - target) < .8:
                if a < 0: a = j
                last = j
            elif a >= 0 and (j - last) * hop > .03:
                runs.append((a, last + 1)); a = -1
        if a >= 0: runs.append((a, last + 1))
        if not runs: continue
        a, b = max(runs, key=lambda r: r[1] - r[0])
        if (b-a)*hop < .06: continue
        time = (begin+a)*hop
        stop = min(duration, (begin+b)*hop)
        pitch = float(np.nanmedian(contour[a:b]))
        level = float(np.mean(levels[begin+a:begin+b]))
        certainty = float(np.mean(confidence[begin+a:begin+b]))
        events.append({'time': time, 'duration': stop-time, 'pitch': pitch,
            'confidence': certainty, 'intensity': float(np.clip(np.sqrt(level)*1.7,.2,1))})
    merged = []
    for event in events:
        if merged:
            previous = merged[-1]
            gap = event['time'] - previous['time'] - previous['duration']
            at = round(event['time']/hop)
            left = levels[max(0,at-round(.12/hop)):at]
            right = levels[at:min(len(levels),at+round(.12/hop))]
            valley = levels[max(0,at-round(.03/hop)):min(len(levels),at+round(.03/hop)+1)]
            continuous = len(left) and len(right) and len(valley) and np.min(valley) > min(np.max(left),np.max(right))*.65
            if gap < .04 and abs(event['pitch']-previous['pitch']) < .75 and continuous:
                end = event['time'] + event['duration']
                a,b = round(previous['time']/hop),round(end/hop)
                previous['duration'] = end-previous['time']
                previous['pitch'] = float(np.nanmedian(pitches[a:b]))
                previous['confidence'] = float(np.mean(confidence[a:b]))
                continue
        merged.append(event)
    attacks = repeated_hum_attacks(pitches, confidence, levels, hop)
    return annotate_hum_drift(split_hum_attacks(merged, attacks), pitches, levels, hop)
