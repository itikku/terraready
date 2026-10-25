"""Verify the running local HTTP service: start `make api`, then `make smoke`."""

import argparse
import json
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8000"


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only live TerraReady checks.")
    parser.add_argument("--base-url", default=BASE_URL)
    base_url = parser.parse_args().base_url.rstrip("/")
    cases = [
        ("north-to-east", None, "NO_GO"),
        ("south-to-east", None, "GO"),
        ("south-to-east", "2026-10-24T12:00:00-07:00", "INSPECT"),
    ]
    try:
        with urlopen(f"{base_url}/ready", timeout=5) as response:
            if json.load(response) != {"status": "ready"}:
                raise SystemExit("Readiness check failed.")
        for route, as_of, expected in cases:
            payload = {"task_id": "east-haul", "machine_id": "loaded-hauler", "route_id": route}
            if as_of:
                payload["as_of"] = as_of
            request = Request(
                f"{base_url}/api/scenarios/post-rain/evaluate",
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
        with urlopen(f"{base_url}/api/scenarios/post-rain/recovery", timeout=5) as response:
            recovery = json.load(response)
        impact = recovery["disruption"]
        if (
            len(recovery["items"]) != 7
            or impact["rerouted_task_ids"] != ["east-haul"]
            or "yard-inspection" not in impact["pulled_forward_task_ids"]
            or impact["dependency_blocked_task_ids"] != ["west-followup"]
        ):
            raise SystemExit(
                "Recovery smoke check failed: docket, reroute, or dependency mismatch."
            )
        print("PASS 7-package docket → rerouted haul, ready yard work, west successor held")
        request = Request(
            f"{base_url}/api/scenarios/post-rain/recovery/evaluate",
            data=json.dumps({"candidate_ids": recovery["selected_candidate_ids"]}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=5) as response:
            checked = json.load(response)
        if checked["id"] != recovery["id"]:
            raise SystemExit(
                "Recovery fingerprint did not survive explicit selection verification."
            )
        print("PASS selected recovery assignments → independently revalidated without mutation")
    except URLError as exc:
        raise SystemExit("Local API unavailable. Run `make seed` and `make api` first.") from exc


if __name__ == "__main__":
    main()
