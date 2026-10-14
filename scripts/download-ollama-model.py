"""Download official qwen3:1.7b OCI layers through curl and verify every digest."""
import hashlib
import json
import os
import pathlib
import subprocess

runtime = pathlib.Path(os.environ.get('PRAXIS_OLLAMA_RUNTIME', '/workspace/runtime/ollama'))
runtime.mkdir(parents=True, exist_ok=True)
manifest_file = runtime / 'qwen3-manifest.json'
if not manifest_file.exists():
    subprocess.run(['curl', '-fsSL', '--max-time', '30', 'https://registry.ollama.ai/v2/library/qwen3/manifests/1.7b', '-o', str(manifest_file)], check=True)
manifest = json.loads(manifest_file.read_text())
blobs = runtime / 'models/blobs'
blobs.mkdir(parents=True, exist_ok=True)
for layer in [manifest['config'], *manifest['layers']]:
    digest = layer['digest']
    if not digest.startswith('sha256:') or len(digest) != 71:
        raise RuntimeError('Invalid manifest digest')
    target = blobs / digest.replace(':', '-')
    temporary = target.with_suffix('.download')
    fresh = not target.exists()
    if fresh:
        subprocess.run(['curl', '-fsSL', '--retry', '3', '--max-time', '900', '-C', '-', 'https://registry.ollama.ai/v2/library/qwen3/blobs/' + digest, '-o', str(temporary)], check=True)
    candidate = temporary if fresh else target
    checksum = hashlib.sha256()
    with candidate.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            checksum.update(chunk)
    if 'sha256:' + checksum.hexdigest() != digest or candidate.stat().st_size != layer['size']:
        raise RuntimeError('Model digest/size mismatch')
    if fresh:
        temporary.rename(target)
    print('verified', digest, layer['size'], flush=True)
path = runtime / 'models/manifests/registry.ollama.ai/library/qwen3/1.7b'
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(manifest))
print('Official qwen3:1.7b installed with validated digests.')
