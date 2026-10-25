"""Fixed loopback inference transport; no proxies, redirects or remote fallback."""

import http.client
import json
from pathlib import Path
from typing import Any, Literal


class InferenceFailure(RuntimeError):
    def __init__(self, reason: Literal["unavailable", "timeout", "invalid_output", "budget"]):
        self.reason = reason
        super().__init__(reason)


class LocalModel:
    mode: Literal["local_model", "test_stub"] = "local_model"
    model_id = "qwen3-4b-q4_k_m"

    def __init__(self, key_file: Path, port: int = 8080):
        self.key_file = key_file
        self.port = port

    def complete(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], timeout: float
    ) -> dict[str, Any]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        try:
            key = self.key_file.read_text().strip()
            if len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
                raise InferenceFailure("unavailable")
            payload = json.dumps(
                {
                    "model": self.model_id,
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "required",
                    "parallel_tool_calls": False,
                    "temperature": 0.7,
                    "top_p": 0.8,
                    "top_k": 20,
                    "min_p": 0,
                    "presence_penalty": 1.5,
                    "seed": 42,
                    "max_tokens": 192,
                    "reasoning_effort": "none",
                    "chat_template_kwargs": {"enable_thinking": False},
                    "stream": False,
                }
            )
            connection.request(
                "POST",
                "/v1/chat/completions",
                payload,
                {"Content-Type": "application/json", "Authorization": "Bearer " + key},
            )
            response = connection.getresponse()
            if response.status != 200:
                raise InferenceFailure("unavailable")
            raw = response.read(65537)
            if len(raw) > 65536:
                raise InferenceFailure("invalid_output")
            body: dict[str, Any] = json.loads(raw)
            if not isinstance(body, dict):
                raise InferenceFailure("invalid_output")
            return body
        except TimeoutError as exc:
            raise InferenceFailure("timeout") from exc
        except (OSError, http.client.HTTPException) as exc:
            raise InferenceFailure("unavailable") from exc
        except (ValueError, UnicodeError) as exc:
            raise InferenceFailure("invalid_output") from exc
        finally:
            connection.close()
