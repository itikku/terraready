"""Read-only orchestration: model interpretation, solver and independent checks."""

from terraready.agent import ModelClient
from terraready.engine import UnknownEntity
from terraready.models import RecoveryRequest, SiteSnapshot
from terraready.recovery import build_recovery
from terraready.solver import StaleSuggestion, solve_suggestion
from terraready.solver_models import WorkSuggestionRequest, WorkSuggestionResponse
from terraready.suggestion_agent import interpret_suggestion


def suggest_work(
    site: SiteSnapshot, body: WorkSuggestionRequest, model: ModelClient
) -> WorkSuggestionResponse:
    if not any(task.id == body.task_id for task in site.tasks):
        raise UnknownEntity("Work item not found.")
    plan = build_recovery(
        site,
        RecoveryRequest(as_of=body.as_of, candidate_ids=body.current_candidate_ids),
    )
    if body.source_plan_id is not None and body.source_plan_id != plan.id:
        raise StaleSuggestion("Work choices or evidence changed. Check the suggestion again.")
    interpretation = interpret_suggestion(site, body, model)
    result = None
    if interpretation.status == "interpreted" and interpretation.intent is not None:
        result = solve_suggestion(site, body, interpretation.intent)
    return WorkSuggestionResponse(
        task_id=body.task_id,
        source_plan_id=plan.id,
        interpretation=interpretation,
        solver=result,
    )
