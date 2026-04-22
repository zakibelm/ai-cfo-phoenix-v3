"""Tests unitaires — observability (ZAKI OS · Z12 AI CFO)."""
from __future__ import annotations

import time

from observability import (
    Timer,
    get_logger,
    get_metrics_snapshot,
    get_request_id,
    record_llm_call,
    record_phase,
    reset_metrics,
    set_request_id,
)


class TestRequestId:
    def test_default_request_id(self) -> None:
        # Dans un nouveau contexte, le default est 'no-request'
        assert get_request_id() is not None

    def test_set_and_retrieve(self) -> None:
        set_request_id("req-test-123")
        assert get_request_id() == "req-test-123"

    def test_auto_generated(self) -> None:
        rid = set_request_id(None)
        assert rid.startswith("req-")


class TestTimer:
    def test_measures_elapsed(self) -> None:
        with Timer() as t:
            time.sleep(0.01)
        assert t.elapsed >= 0.01
        assert t.elapsed < 0.1  # tolérance large

    def test_zero_before_exit(self) -> None:
        t = Timer()
        assert t.elapsed == 0.0


class TestMetrics:
    def setup_method(self) -> None:
        reset_metrics()

    def test_record_llm_call(self) -> None:
        record_llm_call("test-model", 1000, 500, 0.01)
        snap = get_metrics_snapshot()
        assert snap["llm_calls_total"]["test-model"] == 1
        assert snap["llm_tokens_in_total"]["test-model"] == 1000
        assert snap["llm_cost_eur_total"]["test-model"] == 0.01

    def test_record_multiple_calls_accumulates(self) -> None:
        record_llm_call("m1", 100, 50, 0.001)
        record_llm_call("m1", 200, 100, 0.002)
        snap = get_metrics_snapshot()
        assert snap["llm_calls_total"]["m1"] == 2
        assert snap["llm_tokens_in_total"]["m1"] == 300
        assert snap["llm_cost_eur_total"]["m1"] == 0.003

    def test_record_phase(self) -> None:
        record_phase("MAPPING", 1.5)
        record_phase("MAPPING", 2.5)
        snap = get_metrics_snapshot()
        assert snap["phase_latency_sec"]["MAPPING"] == 4.0
        assert snap["phase_count"]["MAPPING"] == 2


class TestLogger:
    def test_logger_instantiable(self) -> None:
        log = get_logger(__name__)
        assert log is not None

    def test_logger_all_levels_callable(self) -> None:
        log = get_logger(__name__)
        # Ne doit pas lever d'exception
        log.debug("test.debug", key="value")
        log.info("test.info", key="value")
        log.warning("test.warning", key="value")
        log.warn("test.warn_alias", key="value")  # alias
        log.error("test.error", key="value")
