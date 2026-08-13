"""Bounded execution policy for integrations and provider adapters."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable, TypeVar
from app.observability import metrics

T = TypeVar("T")

@dataclass
class CircuitBreaker:
    failure_threshold: int = 3
    recovery_seconds: float = 30.0
    failures: int = 0
    opened_at: float | None = None

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        if monotonic() - self.opened_at >= self.recovery_seconds:
            self.opened_at = None
            self.failures = 0
            return True
        return False

    def success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.failure_threshold:
            self.opened_at = monotonic()

_breakers: dict[str, CircuitBreaker] = {}
_breakers_lock = Lock()

def run_bounded(name: str, fn: Callable[[], T], timeout_seconds: float = 8.0) -> T:
    with _breakers_lock:
        breaker = _breakers.setdefault(name, CircuitBreaker())
        if not breaker.allow():
            metrics.increment("integration_circuit_open", integration=name)
            raise TimeoutError(f"integration circuit is open: {name}")
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fn)
        try:
            result = future.result(timeout=timeout_seconds)
        except (FutureTimeout, Exception):
            with _breakers_lock:
                breaker.failure()
            metrics.increment("integration_failure", integration=name)
            future.cancel()
            raise
        else:
            with _breakers_lock:
                breaker.success()
            metrics.increment("integration_success", integration=name)
            return result
