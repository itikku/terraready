"""CI-only model protocol stub + API factory. Never real-inference evidence."""

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from terraready.main import create_app
from terraready.model_client import LocalModel

KEY = "a" * 64  # Public disposable protocol-test value, not a credential.
key_file = Path(".data/e2e-inference.key")
key_file.parent.mkdir(parents=True, exist_ok=True)
key_file.write_text(KEY)
client = LocalModel(key_file, port=8082)
client.mode = "test_stub"
client.model_id = "protocol-test-only"
app = create_app(model_client=client)
stub = FastAPI(title="TEST STUB — not a model")


@stub.get("/health")
def health() -> dict[str, str]:
    return {"mode": "test_stub"}


@stub.post("/v1/chat/completions")
async def completion(request: Request) -> JSONResponse:
    if request.headers.get("authorization") != "Bearer " + KEY:
        return JSONResponse(status_code=401, content={"error": "test authentication"})
    body = await request.json()
    messages = body["messages"]
    question = next(m["content"] for m in messages if m["role"] == "user")
    if "Simulate runtime outage" in question:
        return JSONResponse(status_code=503, content={"error": "deliberate test outage"})
    if "Simulate malformed output" in question:
        return JSONResponse(content={"choices": []})
    tool_results = [m for m in messages if m["role"] == "tool"]
    args: dict[str, object] = {}
    if not tool_results:
        name = "get_shift"
        args = {
            "focus": "blocked"
            if "west-followup" in question
            else "redeploy"
            if "pull forward" in question
            else "reroute"
        }
    else:
        data = json.loads(tool_results[-1]["content"])
        focus = "redeploy" if "pull forward" in question else "reroute"
        if "checked_options" in data:
            if "west-followup" in question:
                name = "finish_analysis"
                args = {"focus": "blocked", "candidate_ids": [], "held_task_ids": ["west-followup"]}
            else:
                name = "evaluate_candidates"
                task = "yard-drainage" if focus == "redeploy" else "east-haul"
                ids = [c["id"] for c in data["checked_options"] if c["task"] == task]
                args = {"candidate_ids": ids}
        else:
            name = "finish_analysis"
            args = {"focus": focus, "candidate_ids": data["checked_ids"], "held_task_ids": []}
    return JSONResponse(
        content={
            "choices": [
                {
                    "finish_reason": "tool_calls",
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "test-call",
                                "type": "function",
                                "function": {"name": name, "arguments": json.dumps(args)},
                            }
                        ],
                    },
                }
            ],
            "usage": {"completion_tokens": 24},
        }
    )
