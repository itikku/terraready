.PHONY: seed api check test smoke

# Run from the repository root after: uv sync --frozen --extra dev
seed:
	.venv/bin/terraready-seed

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
