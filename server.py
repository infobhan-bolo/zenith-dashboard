#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import subprocess
import threading

BASE = Path('/Users/bolo/.openclaw/workspace/zenith-dashboard-requests')
REFRESH_CMD = ['/Applications/Xcode.app/Contents/Developer/usr/bin/python3', str(BASE / 'fetch_zenith_requests.py'), 'refresh']

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/__refresh__'):
            def worker():
                subprocess.run(REFRESH_CMD, cwd=str(BASE), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            threading.Thread(target=worker, daemon=True).start()
            self.send_response(202)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'refresh-started'}).encode())
            return
        return super().do_GET()

if __name__ == '__main__':
    import os
    os.chdir(BASE)
    server = ThreadingHTTPServer(('0.0.0.0', 8766), Handler)
    server.serve_forever()
