import server.camera_lab_server as s


def test_motion_url_falls_back_to_comfy_url():
    assert s.motion_comfy_url(env={}) == s.COMFY_URL


def test_motion_url_uses_env_when_set():
    assert s.motion_comfy_url(env={"COMFYUI_MOTION_URL": "http://127.0.0.1:8188"}) == "http://127.0.0.1:8188"


def test_http_json_uses_base_url(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'

    def fake_urlopen(req, timeout=0):
        captured["url"] = req if isinstance(req, str) else req.full_url
        return FakeResp()

    monkeypatch.setattr(s.urllib.request, "urlopen", fake_urlopen)
    s.http_json("/system_stats", base_url="http://127.0.0.1:8188")
    assert captured["url"].startswith("http://127.0.0.1:8188")
