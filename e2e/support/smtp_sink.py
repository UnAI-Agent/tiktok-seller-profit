"""SMTP sink for the browser harness. Mail on 1025, JSON on 1026. Never a real mailbox."""

import email
import json
from email import policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from aiosmtpd.controller import Controller

_RAW: list[bytes] = []


class _Sink:
    async def handle_DATA(self, server, session, envelope):
        _RAW.append(envelope.content)
        return "250 OK"


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        out = []
        for raw in _RAW:
            msg = email.message_from_bytes(raw, policy=policy.default)
            body = msg.get_body(preferencelist=("plain",)).get_content() if msg.is_multipart() else msg.get_content()
            out.append({"to": msg.get("To") or "", "subject": msg.get("Subject") or "", "body": body})
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    Controller(_Sink(), hostname="127.0.0.1", port=1025).start()
    ThreadingHTTPServer(("127.0.0.1", 1026), _Handler).serve_forever()
