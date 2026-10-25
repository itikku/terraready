"""Verify the running local HTTP service: start `make api`, then `make smoke`."""

import json
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8000"


def main() -> None:
    cases = [
        ("north-to-east", None, "NO_GO"),
        ("south-to-east", None, "GO"),
        ("south-to-east", "2026-10-24T12:00:00-07:00", "INSPECT"),
    ]
    try:
        with urlopen(f"{BASE_URL}/ready", timeout=5) as response:
            if json.load(response) != {"status": "ready"}:
                raise SystemExit("Readiness check failed.")
        for route, as_of, expected in cases:
            payload = {"task_id": "east-haul", "machine_id": "loaded-hauler", "route_id": route}
            if as_of:
                payload["as_of"] = as_of
            request = Request(
                f"{BASE_URL}/api/scenarios/post-rain/evaluate",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            with urlopen(request, timeout=5) as response:
                decision = json.load(response)
            if decision["status"] != expected or decision["requires_approval"] is not True:
                raise SystemExit(f"Smoke check failed for {route}: {decision['status']}")
            print(
                f"PASS {route} / {'expired evidence' if as_of else 'scenario clock'} → {expected}"
            )
    except URLError as exc:
        raise SystemExit("Local API unavailable. Run `make seed` and `make api` first.") from exc


if __name__ == "__main__":
    main()
