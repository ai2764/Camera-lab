import server.camera_lab_server as s


def test_rewrite_motion_prompt_happy_path(monkeypatch):
    monkeypatch.setattr(s, "llm_chat", lambda *_args, **_kwargs: '{"duration": 120, "short_caption": "X walks."}')

    result = s.rewrite_motion_prompt("anything")

    assert result == ("X walks.", 4.0)


def test_rewrite_motion_prompt_malformed_reply_falls_back(monkeypatch):
    monkeypatch.setattr(s, "llm_chat", lambda *_args, **_kwargs: "not json at all")

    result = s.rewrite_motion_prompt("orig text")

    assert result == ("orig text", 4.0)


def test_rewrite_motion_prompt_llm_unavailable_falls_back(monkeypatch):
    def raise_error(*_args, **_kwargs):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(s, "llm_chat", raise_error)

    result = s.rewrite_motion_prompt("orig text")

    assert result == ("orig text", 4.0)
