"""Acoustic repeat/drift evidence, matching lib/music/hum-articulation.ts."""
import math
import numpy as np


def median(values):
    finite = np.sort(values[np.isfinite(values)])
    return float(finite[len(finite) // 2]) if len(finite) else float('nan')


def repeated_hum_attacks(pitches, confidence, levels, hop):
    n = lambda seconds: max(1, math.floor(seconds / hop + .5))
    attacks = []
    i = n(.18)
    while i < len(pitches) - n(.18):
        pitch = pitches[i]
        before = median(pitches[i-n(.16):i-n(.06)])
        after = median(pitches[i+n(.06):i+n(.16)])
        if (not np.isfinite(pitch + before + after) or
            np.any(pitches[i-n(.04):i+n(.04)+1] < pitch) or
            abs(before-after) > .85 or min(before, after)-pitch < .5 or
            confidence[i] > .9):
            i += 1
            continue
        left = levels[i-n(.14):i-n(.02)]
        during = levels[i-n(.02):i+n(.06)]
        right = levels[i+n(.02):i+n(.14)]
        valley = levels[i] / max(1e-12, min(np.max(left), np.max(right)))
        if np.max(during) < np.min(left)*1.1 and valley > .6:
            i += 1
            continue
        start = end = i
        while start > i-n(.12) and np.isfinite(pitches[start-1]) and pitches[start-1] < min(before, after)-.25:
            start -= 1
        while end < i+n(.14) and np.isfinite(pitches[end+1]) and pitches[end+1] < after-.25:
            end += 1
        if (end-start+1)*hop <= .24 and (not attacks or start*hop-attacks[-1] >= .16):
            attacks.append(start*hop)
            i = end
        i += 1
    return attacks


def annotate_hum_drift(events, pitches, levels, hop):
    result = [dict(e) for e in events]
    times = np.arange(len(pitches))*hop
    for i in range(1, len(events)):
        before, after = events[i-1], events[i]
        distance = abs(before['pitch']-after['pitch'])
        if (after['time']-before['time']-before['duration'] > .04 or
            not .3 <= distance <= 1.5 or before['duration'] > .5):
            continue
        contour = np.sort(pitches[(times >= before['time']+.06) & (times < after['time']) & np.isfinite(pitches)])
        if len(contour) < 4 or contour[int(len(contour)*.9)]-contour[int(len(contour)*.1)] < .4:
            continue
        window = pitches[(times >= after['time']-.12) & (times <= after['time']+.08) & np.isfinite(pitches)]
        if len(window) < 4 or np.max(np.abs(np.diff(window)))*.02/hop >= distance*.65:
            continue
        left = levels[(times >= after['time']-.12) & (times < after['time'])]
        right = levels[(times >= after['time']) & (times < after['time']+.1)]
        if len(left) and len(right) and np.max(right) <= np.min(left)*1.25:
            result[i]['pitchDrift'] = True
    return result


def split_hum_attacks(events, attacks):
    result = []
    for event in events:
        cuts = [event['time']]
        stop = event['time']+event['duration']
        for at in attacks:
            if at-cuts[-1] >= .16 and stop-at >= .16:
                cuts.append(at)
        cuts.append(stop)
        result.extend(dict(event, time=a, duration=b-a) for a, b in zip(cuts, cuts[1:]))
    return result
