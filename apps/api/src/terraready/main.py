"""Run from the repository root: uvicorn terraready.main:app --host 127.0.0.1."""

from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request
from fastapi import Path as ApiPath
from fastapi.responses import JSONResponse

from terraready.engine import InvalidEvaluation, UnknownEntity, evaluate
from terraready.models import Evaluation, EvaluationRequest, Model, Scenario, SiteSnapshot
from terraready.seed import database_path
from terraready.storage import DataUnavailable, SiteStore

ScenarioId = Annotated[str, ApiPath(pattern=r"^[a-z][a-z0-9-]{0,63}$")]


class Health(Model):
    status: str


def create_app(db_path: Path | None = None) -> FastAPI:
    api = FastAPI(
        title="TerraReady",
        version="0.1.0",
        description="Synthetic ground-readiness demo. All decisions require supervisor approval.",
    )
    path = db_path or database_path()

    def snapshot() -> SiteSnapshot:
        return SiteStore(path).load()

    def scenario_snapshot(scenario_id: str) -> SiteSnapshot:
        site = snapshot()
        if site.scenario.id != scenario_id:
            raise HTTPException(status_code=404, detail="Scenario not found.")
        return site

    @api.exception_handler(DataUnavailable)
    async def data_unavailable(_request: Request, _exc: DataUnavailable) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": "Demo data unavailable. Stop the API and run the seed command."},
        )

    @api.get("/health", response_model=Health)
    def health() -> Health:
        return Health(status="ok")

    @api.get("/ready", response_model=Health)
    def ready() -> Health:
        snapshot()
        return Health(status="ready")

    @api.get("/api/scenarios", response_model=list[Scenario])
    def scenarios() -> list[Scenario]:
        return [snapshot().scenario]

    @api.get("/api/scenarios/{scenario_id}", response_model=SiteSnapshot)
    def site(scenario_id: ScenarioId) -> SiteSnapshot:
        return scenario_snapshot(scenario_id)

    @api.post("/api/scenarios/{scenario_id}/evaluate", response_model=Evaluation)
    def evaluation(scenario_id: ScenarioId, body: EvaluationRequest) -> Evaluation:
        site = scenario_snapshot(scenario_id)
        try:
            return evaluate(site, body)
        except UnknownEntity as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidEvaluation as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    return api


app = create_app()
