"""OpenTelemetry export is optional and scrubs identifiers before they leave."""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger("marginmark.otel")
SCRUB = re.compile(r"(email|token|authorization|stripe|password|cookie)", re.I)


def scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[redacted]" if SCRUB.search(key) else scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item) for item in value]
    if isinstance(value, str) and ("@" in value or value.startswith("sk_") or value.startswith("whsec_")):
        return "[redacted]"
    return value


def setup(service_name: str) -> None:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not endpoint:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    except ImportError:
        logger.warning("OpenTelemetry packages are not installed")
        return
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
    trace.set_tracer_provider(provider)


def emit_error(payload: dict[str, Any]) -> None:
    logger.info("extension_error %s", scrub(payload))
