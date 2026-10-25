"""Single-process FIFO admission for the shared demo's bounded model loop."""

from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager
from threading import Condition
from time import monotonic


class QueueUnavailable(RuntimeError):
    """Admission failed; deterministic planning is still available."""


class AssistQueue:
    def __init__(
        self, *, capacity: int = 10, wait_seconds: float = 30, cooldown_seconds: float = 10
    ) -> None:
        if not 1 <= capacity <= 10 or wait_seconds <= 0 or cooldown_seconds < 0:
            raise ValueError("Invalid shared inference limits.")
        self.capacity = capacity
        self.wait_seconds = wait_seconds
        self.cooldown_seconds = cooldown_seconds
        self._condition = Condition()
        self._waiting: deque[str] = deque()
        self._active: str | None = None
        self._next_allowed: dict[str, float] = {}

    @contextmanager
    def admit(self, visitor: str) -> Iterator[None]:
        with self._condition:
            now = monotonic()
            # Bound the rate-limit map by retaining only unexpired entries.
            self._next_allowed = {k: v for k, v in self._next_allowed.items() if v > now}
            if visitor == self._active or visitor in self._waiting:
                raise QueueUnavailable("You already have an analysis running or waiting.")
            if visitor in self._next_allowed:
                raise QueueUnavailable("Please wait a few seconds before asking again.")
            if len(self._waiting) + int(self._active is not None) >= self.capacity:
                raise QueueUnavailable("The shared analysis queue is full. Please retry shortly.")
            self._next_allowed[visitor] = now + self.cooldown_seconds
            self._waiting.append(visitor)
            deadline = now + self.wait_seconds
            try:
                while self._active is not None or self._waiting[0] != visitor:
                    remaining = deadline - monotonic()
                    if remaining <= 0:
                        raise QueueUnavailable("The shared model is busy. Please retry shortly.")
                    self._condition.wait(remaining)
                self._waiting.popleft()
                self._active = visitor
            except BaseException:
                self._waiting.remove(visitor)
                self._condition.notify_all()
                raise
        try:
            yield
        finally:
            with self._condition:
                self._active = None
                self._condition.notify_all()

    def status(self) -> dict[str, int | float]:
        with self._condition:
            return {
                "running": int(self._active is not None),
                "waiting": len(self._waiting),
                "capacity": self.capacity,
                "max_queue_wait_seconds": self.wait_seconds,
                "per_visitor_cooldown_seconds": self.cooldown_seconds,
            }
