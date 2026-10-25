.PHONY: seed api check test smoke web web-check controller-check browser-check verify model agent-smoke

# Run from the repository root after: uv sync --frozen --extra dev
seed:
	.venv/bin/terraready-seed --docket data/fixtures/shift-docket.json

api:
	.venv/bin/uvicorn terraready.main:app --host 127.0.0.1 --port 8000

check:
	.venv/bin/ruff format --check apps tests scripts
	.venv/bin/ruff check apps tests scripts
	.venv/bin/mypy
	.venv/bin/pytest --cov --cov-branch

test:
	.venv/bin/pytest

smoke:
	.venv/bin/python scripts/smoke_api.py

web:
	npm run dev

web-check:
	npm run format:check
	npm run check
	npm run build

browser-check:
	npm run test:e2e

controller-check:
	npm run controller:check

verify: check web-check controller-check browser-check

model:
	.venv/bin/python scripts/serve_model.py

agent-smoke:
	.venv/bin/python -u scripts/evaluate_agent.py
