"""
observability.py — ZAKI OS Z12 AI CFO Suite
─────────────────────────────────────────────────────────────────────────────
Logger structuré JSON + métriques cost/tokens/latency + request_id correlation.

Fallback gracieux si structlog absent : on utilise stdlib logging avec une
façade compatible, pour que le reste du code n'ait pas à brancher de if.

Usage :
    from observability import get_logger, Timer, set_request_id

    log = get_logger(__name__)
    with Timer() as t:
        result = do_work()
    log.info("work.done", duration_sec=t.elapsed, result_id=result.id)
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import time
import uuid
from typing import Any

# ─────────────────────────────────────────────────────────────────────────────
# Context var pour request_id (propagé dans tous les logs d'une même requête)
# ─────────────────────────────────────────────────────────────────────────────

_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="no-request"
)


def set_request_id(rid: str | None = None) -> str:
    """Définit le request_id courant. Retourne l'ID (généré si None)."""
    final = rid or f"req-{uuid.uuid4().hex[:12]}"
    _request_id_var.set(final)
    return final


def get_request_id() -> str:
    return _request_id_var.get()


# ─────────────────────────────────────────────────────────────────────────────
# Façade de logger avec API structlog-like, backed by stdlib si structlog absent
# ─────────────────────────────────────────────────────────────────────────────

try:
    import structlog  # type: ignore
    _HAS_STRUCTLOG = True
except ImportError:
    _HAS_STRUCTLOG = False


def _configure_stdlib() -> None:
    """Configure stdlib logging pour sortir en JSON avec request_id."""
    class JSONFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload: dict[str, Any] = {
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
                "level": record.levelname.lower(),
                "logger": record.name,
                "event": record.getMessage(),
                "request_id": get_request_id(),
            }
            # kwargs passés via `extra=...`
            if hasattr(record, "extra_fields"):
                payload.update(record.extra_fields)  # type: ignore[attr-defined]
            if record.exc_info:
                payload["exc_info"] = self.formatException(record.exc_info)
            return json.dumps(payload, ensure_ascii=False, default=str)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())


if _HAS_STRUCTLOG:
    def _add_request_id(_, __, event_dict: dict[str, Any]) -> dict[str, Any]:
        event_dict["request_id"] = get_request_id()
        return event_dict

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_request_id,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(ensure_ascii=False),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )
else:
    _configure_stdlib()


class _LoggerFacade:
    """API commune structlog/stdlib — permet au reste du code de ne pas switcher."""

    def __init__(self, name: str) -> None:
        if _HAS_STRUCTLOG:
            self._impl = structlog.get_logger(name)
        else:
            self._impl = logging.getLogger(name)

    def _log(self, level: str, event: str, **kwargs: Any) -> None:
        if _HAS_STRUCTLOG:
            getattr(self._impl, level)(event, **kwargs)
        else:
            # Passe les kwargs via extra_fields (custom)
            record = logging.LogRecord(
                self._impl.name, getattr(logging, level.upper()), "", 0, event, (), None
            )
            record.extra_fields = kwargs  # type: ignore[attr-defined]
            self._impl.handle(record)

    def debug(self, event: str, **kwargs: Any) -> None:
        self._log("debug", event, **kwargs)

    def info(self, event: str, **kwargs: Any) -> None:
        self._log("info", event, **kwargs)

    def warning(self, event: str, **kwargs: Any) -> None:
        self._log("warning", event, **kwargs)

    # Alias legacy pour compat avec .warn()
    def warn(self, event: str, **kwargs: Any) -> None:
        self._log("warning", event, **kwargs)

    def error(self, event: str, **kwargs: Any) -> None:
        self._log("error", event, **kwargs)

    def critical(self, event: str, **kwargs: Any) -> None:
        self._log("critical", event, **kwargs)


def get_logger(name: str) -> _LoggerFacade:
    """Retourne un logger compatible structlog/stdlib."""
    return _LoggerFacade(name)


# ─────────────────────────────────────────────────────────────────────────────
# Timer — context manager pour mesurer la latence
# ─────────────────────────────────────────────────────────────────────────────

class Timer:
    """
    Context manager pour mesurer la durée d'un bloc.

    Usage :
        with Timer() as t:
            do_work()
        print(t.elapsed)  # secondes (float)
    """

    def __init__(self) -> None:
        self._start: float = 0.0
        self.elapsed: float = 0.0

    def __enter__(self) -> Timer:
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.elapsed = time.perf_counter() - self._start


# ─────────────────────────────────────────────────────────────────────────────
# Métriques simples (en mémoire) — suffit pour le MVP
# Prometheus endpoint possible en extension
# ─────────────────────────────────────────────────────────────────────────────

_metrics: dict[str, dict[str, float]] = {
    "llm_calls_total": {},       # {model: count}
    "llm_tokens_in_total": {},   # {model: tokens}
    "llm_tokens_out_total": {},  # {model: tokens}
    "llm_cost_eur_total": {},    # {model: eur}
    "phase_latency_sec": {},     # {phase: seconds total}
    "phase_count": {},           # {phase: count}
}


def record_llm_call(model: str, tokens_in: int, tokens_out: int, cost_eur: float) -> None:
    _metrics["llm_calls_total"][model] = _metrics["llm_calls_total"].get(model, 0) + 1
    _metrics["llm_tokens_in_total"][model] = _metrics["llm_tokens_in_total"].get(model, 0) + tokens_in
    _metrics["llm_tokens_out_total"][model] = _metrics["llm_tokens_out_total"].get(model, 0) + tokens_out
    _metrics["llm_cost_eur_total"][model] = _metrics["llm_cost_eur_total"].get(model, 0.0) + cost_eur


def record_phase(phase: str, duration_sec: float) -> None:
    _metrics["phase_latency_sec"][phase] = _metrics["phase_latency_sec"].get(phase, 0.0) + duration_sec
    _metrics["phase_count"][phase] = _metrics["phase_count"].get(phase, 0) + 1


def get_metrics_snapshot() -> dict[str, dict[str, float]]:
    """Retourne une copie immuable des métriques courantes."""
    return {k: dict(v) for k, v in _metrics.items()}


def reset_metrics() -> None:
    """Utile pour les tests."""
    for v in _metrics.values():
        v.clear()
