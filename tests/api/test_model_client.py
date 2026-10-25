import io
import json
from http.client import HTTPException

import pytest
from terraready.model_client import InferenceFailure, LocalModel


class Connection:
    def __init__(self, body, status=200, error=None):
        self.body = body
        self.status = status
        self.error = error
        self.closed = False

    def request(self, method, path, body=None, headers=None):
        self.sent = (method, path, json.loads(body) if body else None, headers)
        if self.error:
            raise self.error

    def getresponse(self):
        stream = io.BytesIO(self.body)
        stream.status = self.status
        return stream

    def close(self):
        self.closed = True


def setup(tmp_path, monkeypatch, body=b"{}", status=200, error=None):
    key = tmp_path / "key"
    key.write_text("a" * 64)
    connection = Connection(body, status, error)

    def connect(host, port, timeout):
        assert host == "127.0.0.1" and port == 8080 and timeout in (1, 3)
        return connection

    monkeypatch.setattr("terraready.model_client.http.client.HTTPConnection", connect)
    return LocalModel(key), connection


def test_only_fixed_loopback_authenticated_nonstreaming_transport(tmp_path, monkeypatch):
    client, connection = setup(tmp_path, monkeypatch, b'{"choices": []}')
    assert client.complete([], [], 3) == {"choices": []}
    method, path, body, headers = connection.sent
    assert (method, path) == ("POST", "/v1/chat/completions")
    assert headers["Authorization"] == "Bearer " + "a" * 64
    assert body["max_tokens"] == 192
    assert body["stream"] is False
    assert body["chat_template_kwargs"]["enable_thinking"] is False
    assert connection.closed


@pytest.mark.parametrize(
    "raw,status,error,reason",
    [
        (b"{}", 302, None, "unavailable"),
        (b"{}", 500, None, "unavailable"),
        (b"x" * 65537, 200, None, "invalid_output"),
        (b"not json", 200, None, "invalid_output"),
        (b"[]", 200, None, "invalid_output"),
        (b"\xff", 200, None, "invalid_output"),
        (b"{}", 200, TimeoutError("private"), "timeout"),
        (b"{}", 200, OSError("private"), "unavailable"),
        (b"{}", 200, HTTPException("private"), "unavailable"),
    ],
)
def test_failure_is_bounded_and_sanitized(tmp_path, monkeypatch, raw, status, error, reason):
    client, connection = setup(tmp_path, monkeypatch, raw, status, error)
    with pytest.raises(InferenceFailure, match=reason) as caught:
        client.complete([], [], 3)
    assert "private" not in str(caught.value)
    assert connection.closed


@pytest.mark.parametrize("key", [None, "bad", "g" * 64])
def test_missing_or_invalid_key_never_makes_request(tmp_path, monkeypatch, key):
    client, connection = setup(tmp_path, monkeypatch)
    if key is None:
        client.key_file.unlink()
    else:
        client.key_file.write_text(key)
    with pytest.raises(InferenceFailure, match="unavailable"):
        client.complete([], [], 3)
    assert not hasattr(connection, "sent")


@pytest.mark.parametrize(
    "body,status,expected",
    [
        (b'{"data":[{"id":"qwen3-4b-q4_k_m"}]}', 200, True),
        (b'{"data":[{"id":"different-model"}]}', 200, False),
        (b'{"data":[null]}', 200, False),
        (b'{"data":null}', 200, False),
        (b"[]", 200, False),
        (b"bad json", 200, False),
        (b"{}", 401, False),
        (b"x" * 16385, 200, False),
    ],
)
def test_runtime_probe_checks_identity_not_inference_quality(
    tmp_path, monkeypatch, body, status, expected
):
    client, connection = setup(tmp_path, monkeypatch, body, status)
    assert client.available() is expected
    assert connection.closed
    assert connection.sent[0:2] == ("GET", "/v1/models")


def test_runtime_probe_is_unavailable_on_bad_key_or_timeout(tmp_path, monkeypatch):
    client, connection = setup(tmp_path, monkeypatch, error=TimeoutError())
    assert client.available() is False
    client.key_file.write_text("invalid")
    assert client.available() is False
