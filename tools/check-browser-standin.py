#!/usr/bin/env python3
"""Small HTTP listeners, no renderer/GPU. Exercise the actual startup/watchdogs."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import hashlib
import json
import os
import sys
import time

browser = any(a.startswith('--remote-debugging-port=') for a in sys.argv)
if browser:
    port = int(next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--remote-debugging-port=')))
    profile = next(a.split('=', 1)[1] for a in sys.argv if a.startswith('--user-data-dir='))
    token = hashlib.sha256(profile.encode()).hexdigest()
    endpoint = f'ws://127.0.0.1:{port}/devtools/browser/{token}'
    print('DevTools listening on '+endpoint, flush=True)
else:
    port, root = int(sys.argv[2]), Path(sys.argv[3])
    if os.environ.get('MMM_PROOF_DELAY_SERVER'):
        Path(os.environ['MMM_PROOF_DELAY_SERVER']).write_text('server has started, before listen')
        time.sleep(60)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if browser:
            body = json.dumps({'webSocketDebuggerUrl': endpoint, 'profile': profile}).encode()
            content_type = 'application/json'
        else:
            body = (root/'tools/check-ports-probe.html').read_bytes()
            content_type = 'text/html'
        self.send_response(200); self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_args): pass


HTTPServer(('127.0.0.1', port), Handler).serve_forever()
