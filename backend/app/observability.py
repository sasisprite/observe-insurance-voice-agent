"""Small dependency-free observability primitives; replace with OpenTelemetry in production."""
from __future__ import annotations
import json
import logging
from collections import defaultdict
from threading import Lock
from time import monotonic
from typing import Any

logger = logging.getLogger("voice_agent")

class Metrics:
    def __init__(self):
        self._lock = Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = defaultdict(int)
        self._timings: dict[tuple[str, tuple[tuple[str, str], ...]], list[float]] = defaultdict(list)

    def increment(self, name: str, value: int = 1, **labels: Any) -> None:
        key = (name, tuple(sorted((key, str(value)) for key, value in labels.items())))
        with self._lock:
            self._counters[key] += value

    def observe(self, name: str, seconds: float, **labels: Any) -> None:
        key = (name, tuple(sorted((key, str(value)) for key, value in labels.items())))
        with self._lock:
            self._timings[key].append(round(seconds, 6))

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "counters": [{"name": name, "labels": dict(labels), "value": value} for (name, labels), value in self._counters.items()],
                "timings": [{"name": name, "labels": dict(labels), "count": len(values), "avgSeconds": sum(values) / len(values), "maxSeconds": max(values)} for (name, labels), values in self._timings.items() if values],
            }

metrics = Metrics()

def log_event(event: str, **fields: Any) -> None:
    logger.info(json.dumps({"event": event, **fields}, default=str, sort_keys=True))

class Timer:
    def __init__(self, metric: str, **labels: Any):
        self.metric = metric
        self.labels = labels
        self.started = monotonic()

    def stop(self) -> None:
        metrics.observe(self.metric, monotonic() - self.started, **self.labels)
