"""Tiny HOPS API client for the stress run (throwaway instance only)."""
import json, time, urllib.request, urllib.error, http.cookiejar, uuid

BASE = "http://127.0.0.1:18200"
PASSWORD = "stress-test-pw-3000"


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def csrf(self):
        return next((c.value for c in self.jar if c.name == "hops_csrf"), "")

    def req(self, method, path, body=None, ctype="application/json", timeout=300):
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        r = urllib.request.Request(BASE + path, data=data, method=method)
        if data is not None:
            r.add_header("Content-Type", ctype)
        if method not in ("GET", "HEAD"):
            r.add_header("X-CSRF-Token", self.csrf())
        t = time.perf_counter()
        try:
            with self.op.open(r, timeout=timeout) as resp:
                raw, code, hdrs = resp.read(), resp.status, dict(resp.headers)
        except urllib.error.HTTPError as e:
            raw, code, hdrs = e.read(), e.code, dict(e.headers)
        ms = (time.perf_counter() - t) * 1000
        try:
            js = json.loads(raw)
        except Exception:
            js = None
        return code, js, raw, ms, hdrs

    def login(self):
        code, js, *_ = self.req("POST", "/api/auth/login", {"username": "admin", "password": PASSWORD})
        if code != 200:
            code, js, *_ = self.req("POST", "/api/auth/login", {"username": "admin", "password": "admin"})
            assert code == 200, (code, js)
            code, js, *_ = self.req("POST", "/api/auth/change-password",
                                    {"oldPassword": "admin", "newPassword": PASSWORD})
            assert code == 200, (code, js)
        return self

    def upload(self, path, filename, data, fields=None, mime=None):
        mime = mime or {'jpg': 'image/jpeg', 'png': 'image/png', 'zip': 'application/zip'}.get(filename.rsplit('.', 1)[-1], 'application/octet-stream')
        b = uuid.uuid4().hex
        parts = []
        for k, v in (fields or {}).items():
            parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                     f'Content-Type: {mime}\r\n\r\n'.encode() + data + b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        return self.req("POST", path, b"".join(parts), ctype=f"multipart/form-data; boundary={b}")
