#!/usr/bin/env python3
"""Preserve TapComposer's microphone permission when ServerChirp rewrites Nginx."""
from pathlib import Path
import subprocess

config = Path('/etc/nginx/sites-available/serverchirp-cmucpqz6100ng0qanwxw7j8i8.conf')
before = config.read_text()
if 'server_name tapcomposer.dashwood.net;' not in before:
    raise SystemExit('Unexpected virtual host; refusing to change it')
after = before.replace('microphone=()', 'microphone=(self)')
if after == before:
    raise SystemExit(0)
config.write_text(after)
try:
    subprocess.run(['/usr/sbin/nginx', '-t'], check=True)
except subprocess.CalledProcessError:
    config.write_text(before)
    raise
subprocess.run(['/usr/bin/systemctl', 'reload', 'nginx'], check=True)
