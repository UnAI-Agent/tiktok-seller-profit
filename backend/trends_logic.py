"""Anonymous trend rollups. Rows have no IP and no user id."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

K_THRESHOLD = 5


def rollup(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        week = str(event["week"])
        grouped[(week, str(event["product_id"]))].append(event)
    rows = []
    for (week, product_id), bucket in grouped.items():
        tokens = {row["week_token"] for row in bucket}
        lookups = sum(1 for row in bucket if row["event"] == "product_checked")
        adds = sum(1 for row in bucket if row["event"] == "product_added")
        removes = sum(1 for row in bucket if row["event"] == "product_removed")
        prices = sorted(float(row["price"]) for row in bucket if row.get("price") is not None)
        sold = [float(row["sold_count"]) for row in bucket if row.get("sold_count") is not None]
        rows.append(
            {
                "week": week,
                "product_id": product_id,
                "lookups": lookups,
                "distinct_tokens": len(tokens),
                "adds": adds,
                "removes": removes,
                "sold_delta": (max(sold) - min(sold)) if len(sold) >= 2 else 0,
                "price_p50": prices[len(prices) // 2] if prices else None,
            }
        )
    return rows


def visible(rows: list[dict[str, Any]], *, limit: int | None = None) -> list[dict[str, Any]]:
    kept = [row for row in rows if int(row["distinct_tokens"]) >= K_THRESHOLD]
    kept.sort(key=lambda row: int(row["lookups"]), reverse=True)
    if limit is None:
        return kept
    return kept[:limit]
