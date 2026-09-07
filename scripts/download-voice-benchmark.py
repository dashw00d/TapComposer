"""Fetch optional real-voice evaluation data. Nothing is added to app assets."""
import argparse
import hashlib
import json
import pathlib
import re
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'outputs' / 'voice-benchmark'


def checksum(path, algorithm='md5'):
    digest = hashlib.new(algorithm)
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def download(url, archive, expected):
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_suffix('.download')
        print(f'Downloading {archive.name}', flush=True)
        urllib.request.urlretrieve(url, temporary)
        if checksum(temporary) != expected:
            raise RuntimeError('Dataset checksum mismatch')
        temporary.replace(archive)
    if checksum(archive) != expected:
        raise RuntimeError(f'Checksum mismatch: {archive}; remove incomplete archive and retry')
    return archive


def vocadito():
    url = 'https://zenodo.org/records/5578807/files/vocadito.zip?download=1'
    archive = download(url, ROOT / 'vocadito.zip', 'dea40fd18f14d899643c4ba221b33a46')
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            target = (ROOT / member.filename).resolve()
            if not target.is_relative_to(ROOT.resolve()):
                raise RuntimeError('Unsafe archive path')
            if '__MACOSX' not in member.filename and not member.filename.endswith('.DS_Store'):
                source.extract(member, ROOT)
    print('vocadito: checksum verified; 40 annotated recordings ready', flush=True)


def rsh():
    url = 'https://zenodo.org/records/3816618/files/read%20sing%20and%20humm.zip?download=1'
    archive = download(url, ROOT / 'rsh' / 'rsh.zip', 'acd449590e7608bf4ca48106672be16f')
    audio = ROOT / 'rsh' / 'audio'
    audio.mkdir(exist_ok=True)
    by_speaker = {}
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            name = pathlib.PurePosixPath(member.filename).name
            # RSH's w-series (wordless), excluding reading/singing and TI files.
            match = re.fullmatch(r'([fm]_spk\d+)_w\d+_\d+\.wav', name)
            if not match:
                continue
            content = source.read(member)
            (audio / name).write_bytes(content)
            by_speaker.setdefault(match[1], []).append({
                'id': name[:-4], 'audio': f'rsh/audio/{name}',
                'archivePath': member.filename,
                'sha256': hashlib.sha256(content).hexdigest(),
                'annotationStatus': 'unlabeled',
            })
    # Three deterministic examples from every available speaker for the gallery.
    samples = []
    for speaker in sorted(by_speaker):
        samples.extend(sorted(by_speaker[speaker], key=lambda x: hashlib.sha256(x['id'].encode()).digest())[:3])
    manifest = {
        'source': 'https://zenodo.org/records/3816618',
        'attribution': 'shi (2020). RSH dataset. Zenodo. DOI: 10.5281/zenodo.3816618',
        'license': 'CC-BY-4.0', 'archiveMd5': 'acd449590e7608bf4ca48106672be16f',
        'selection': 'RSH w-series; three SHA256-ordered filenames per speaker for listening only',
        'speakers': len(by_speaker), 'availableSamples': sum(map(len, by_speaker.values())),
        'samples': samples,
    }
    (ROOT / 'rsh' / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f"RSH: checksum verified; {manifest['availableSamples']} w-series files; {len(samples)} gallery examples from {len(by_speaker)} speakers", flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rsh', action='store_true', help='Also download the 307 MB wordless voice corpus')
    args = parser.parse_args()
    vocadito()
    if args.rsh:
        rsh()
