"""Run from the repository root: uvicorn terraready.main:app --host 127.0.0.1."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi import Path as ApiPath
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime

from terraready.engine import InvalidEvaluation, UnknownEntity, evaluate, evaluate_zone
from terraready.models import (
    Approval,
    ApprovalRequest,
    Evaluation,
    EvaluationRequest,
    Model,
    Readiness,
    Scenario,
    ShiftPlan,
    SiteSnapshot,
)
from terraready.planner import build_plan, make_approval
from terraready.seed import database_path
from terraready.storage import ApprovalUnavailable, DataUnavailable, SiteStore

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

    @api.exception_handler(ApprovalUnavailable)
    async def approval_unavailable(_request: Request, _exc: ApprovalUnavailable) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": "Local approval unavailable. Please retry; nothing was dispatched."},
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

    @api.get("/api/scenarios/{scenario_id}/readiness", response_model=Readiness)
    def readiness(
        scenario_id: ScenarioId,
        machine_id: Annotated[str, Query(pattern=r"^[a-z][a-z0-9-]{0,63}$")],
        as_of: AwareDatetime | None = None,
    ) -> Readiness:
        site = scenario_snapshot(scenario_id)
        machine = next((m for m in site.machines if m.id == machine_id), None)
        if machine is None:
            raise HTTPException(status_code=404, detail="Machine not found.")
        clock = as_of or site.scenario.as_of
        if clock < site.scenario.as_of:
            raise HTTPException(
                status_code=422, detail="Clock cannot precede the scenario snapshot."
            )
        return Readiness(
            scenario_id=scenario_id,
            machine_id=machine_id,
            as_of=clock,
            zones=[
                evaluate_zone(zone, machine, site.observations, site.scenario, clock)
                for zone in site.zones
            ],
        )

    @api.post("/api/scenarios/{scenario_id}/evaluate", response_model=Evaluation)
    def evaluation(scenario_id: ScenarioId, body: EvaluationRequest) -> Evaluation:
        site = scenario_snapshot(scenario_id)
        try:
            return evaluate(site, body)
        except UnknownEntity as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except InvalidEvaluation as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @api.get("/api/scenarios/{scenario_id}/plan", response_model=ShiftPlan)
    def plan(scenario_id: ScenarioId, as_of: AwareDatetime | None = None) -> ShiftPlan:
        site = scenario_snapshot(scenario_id)
        try:
            result = build_plan(site, as_of)
        except InvalidEvaluation as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        result.approval = SiteStore(path).approval(result.id)
        return result

    @api.post("/api/scenarios/{scenario_id}/approvals", response_model=Approval)
    def approve(scenario_id: ScenarioId, body: ApprovalRequest) -> Approval:
        site = scenario_snapshot(scenario_id)
        try:
            proposal = build_plan(site, body.as_of)
        except InvalidEvaluation as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if proposal.id != body.plan_id:
            raise HTTPException(
                status_code=409, detail="Proposal changed. Refresh and review it again."
            )
        if proposal.proposed_eligible_count == 0:
            raise HTTPException(
                status_code=409, detail="All work is held. Fresh evidence is required."
            )
        return SiteStore(path).save_approval(make_approval(site, proposal, datetime.now(UTC)))

    return api


app = create_app()
