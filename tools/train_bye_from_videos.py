"""Train the DollarPy Bye Bye templates from the recorded videos in Hands/<Bye|Other>/*.mp4.

    python tools/train_bye_from_videos.py            # uses tools/wave-data/landmarks.json if present
    python tools/train_bye_from_videos.py --refresh  # re-run MediaPipe on the videos first

Steps: MediaPipe palm/roll trajectories -> sliding windows like the live client -> DollarPy
leave-one-video-out evaluation -> bye_bye_templates.json used by server.py.
"""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tools'))
from bye_bye_gesture import ByeByeRecognizer, LABELS, FEATURE, MAX_TEMPLATES, roll_swing, ROLL_GATE  # noqa: E402

CACHE = ROOT / 'tools/wave-data/landmarks.json'
TARGET = ROOT / 'bye_bye_templates.json'
TRAIN_WINDOWS = (1.2, 1.8, 2.4)   # seconds; matches the live client's rolling window (1.2-2.5 s)
LIVE_WINDOWS = (1.2, 1.8, 2.5)


def video_aspect(video):
    if video.get('aspect'):
        return video['aspect']
    try:
        import cv2
        cap = cv2.VideoCapture(str(ROOT / video['video']))
        w, h = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        cap.release()
        if w and h:
            return w / h
    except ImportError:
        pass
    return 16 / 9


def frames(track, aspect):
    """Cached entries are [t, x_mirrored, y, roll_normalised, openness] -> (t, [x, y, roll_pixels])."""
    return [(e[0], [e[1], e[2], math.atan2(aspect * math.sin(e[3]), math.cos(e[3]))]) for e in track]


def windows(track, length, step):
    if not track:
        return []
    if track[-1][0] - track[0][0] <= length:
        return [track]
    out, start = [], track[0][0]
    while start + length <= track[-1][0] + 1e-6:
        out.append([f for f in track if start <= f[0] <= start + length])
        start += step
    return out


def load_videos(refresh):
    if refresh or not CACHE.exists():
        import train_wave_videos  # needs mediapipe + opencv (hci_project environment)
        sys.argv = [sys.argv[0], '--refresh']
        train_wave_videos.main()
    data = json.loads(CACHE.read_text(encoding='utf-8'))
    videos = []
    for v in data['videos']:
        aspect = video_aspect(v)
        tracks = [frames(t, aspect) for t in v['tracks'].values() if len(t) >= 8]
        videos.append({'name': Path(v['video']).name, 'label': v['label'], 'tracks': tracks})
    return videos


def samples_for(videos):
    samples = {label: [] for label in LABELS}
    for v in videos:
        for track in v['tracks']:
            candidates = [track] + [w for length in TRAIN_WINDOWS for w in windows(track, length, .3)]
            for w in candidates:
                points = [p for _, p in w]
                if len(points) < 8:
                    continue
                # A Bye Bye video also contains the hand being raised/held: only the swinging parts are Bye Bye.
                if v['label'] == 'Bye Bye':
                    swing, reversals = roll_swing(points)
                    if swing < ROLL_GATE or reversals < 1:
                        continue
                samples[v['label']].append(points)
    for label in LABELS:
        items = samples[label]
        if len(items) > MAX_TEMPLATES:
            samples[label] = [items[round(i * (len(items) - 1) / (MAX_TEMPLATES - 1))] for i in range(MAX_TEMPLATES)]
    return samples


def triggers(samples, track, threshold):
    best = None
    for length in LIVE_WINDOWS:
        for w in windows(track, length, .2):
            points = [p for _, p in w]
            if len(points) < 8:
                continue
            result = ByeByeRecognizer.classify(samples, points, threshold)
            if result['toggle']:
                return True, result
            if result['name'] == 'Bye Bye' and (best is None or result['score'] > best['score']):
                best = result
    return False, best


def evaluate(videos, threshold):
    print(f'\nLeave-one-video-out evaluation (threshold {threshold}):')
    correct = 0
    for i, v in enumerate(videos):
        train = samples_for([o for j, o in enumerate(videos) if j != i])
        fired, info = False, None
        for track in v['tracks']:
            fired, info = triggers(train, track, threshold)
            if fired:
                break
        ok = fired == (v['label'] == 'Bye Bye')
        correct += ok
        detail = f"score {info['score']:.2f} swing {info['swing']:.2f}" if info else 'no swing'
        print(f"  {'OK  ' if ok else 'MISS'} {v['label']:8} {v['name']}: {'theme toggles' if fired else 'no toggle'} ({detail})")
    print(f'  => {correct}/{len(videos)} videos correct')
    return correct


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='re-extract landmarks from the videos with MediaPipe')
    parser.add_argument('--no-eval', action='store_true')
    args = parser.parse_args()
    videos = load_videos(args.refresh)
    print('Videos:', ', '.join(f"{v['name']} ({v['label']})" for v in videos))
    recognizer = ByeByeRecognizer(TARGET)
    if not args.no_eval:
        evaluate(videos, recognizer.threshold)
    samples = samples_for(videos)
    data = {'source': 'Hands/ videos -> MediaPipe Hands palm + roll -> DollarPy (tools/train_bye_from_videos.py)',
            'feature': FEATURE, 'samples': samples}
    try:
        old = json.loads(TARGET.read_text(encoding='utf-8-sig')) if TARGET.exists() else {}
        if old.get('feature') == FEATURE and old.get('user_samples'):
            data['user_samples'] = old['user_samples']
    except (ValueError, OSError):
        pass
    recognizer.write(data)
    print(f"\nSaved {TARGET.name}: " + ', '.join(f'{label} {len(samples[label])} templates' for label in LABELS))
    print('Status:', recognizer.status())


if __name__ == '__main__':
    main()
