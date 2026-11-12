"""Validate final npm tarballs in a clean temporary directory, without installing into DSH."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile

root = Path(__file__).resolve().parent.parent
release = root / 'release'
manifest = json.loads((release / 'manifest.json').read_text(encoding='utf-8'))
node = os.environ.get('NODE_EXECUTABLE', 'node')
expected = {p.name for p in (root / 'plugins').iterdir() if p.is_dir()}
assert {item['plugin'] for item in manifest} == expected
assert len(manifest) == len(expected)
assert 'dsh-wb-signin' not in expected
with tempfile.TemporaryDirectory(prefix='dsh-plugin-packages-') as temp:
    for item in manifest:
        archive = release / item['file']
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == item['sha256']
        destination = Path(temp) / item['plugin']
        destination.mkdir()
        with tarfile.open(archive, 'r:gz') as tar:
            for member in tar.getmembers():
                p = PurePosixPath(member.name)
                assert not p.is_absolute() and '..' not in p.parts
                assert p.parts[0] == 'package'
                assert member.isfile() or member.isdir(), member.name
                assert not any(part in {'node_modules', '__pycache__', '.git', '.env'} for part in p.parts)
                assert not p.name.endswith(('.log', '.pyc', '.bak'))
                assert not (p.parts[1:3] in [('assets', 'samples'), ('assets', 'answers'), ('assets', 'stem')])
            tar.extractall(destination, filter='data')
        package = destination / 'package'
        pkg = json.loads((package / 'package.json').read_text(encoding='utf-8'))
        assert pkg['name'] == item['name'] and pkg['version'] == item['version']
        for file in [pkg['exports']['.'], pkg['exports']['./client'], pkg['dsh']['bundle']['patch'], 'README.md', 'LICENSE']:
            assert (package / file).is_file(), (item['plugin'], file)
        if item['plugin'] == 'dsh-score-analysis':
            assert (package / 'python/vendor_xlrd/LICENSE').is_file()
        if item['plugin'] == 'dsh-sanview-studio':
            assert (package / 'embed/index.html').is_file()
        subprocess.run([node, '--input-type=module', '-e', 'const m=await import(process.argv[1]); if(typeof m.apply!=="function") process.exit(1)', (package / pkg['exports']['.']).as_uri()], check=True)
        print('Verified', item['file'], flush=True)
print('PASS: all extracted tarballs, digests, manifests, licenses and standalone host imports')
