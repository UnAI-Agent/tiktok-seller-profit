# Alerts

Configure these in New Relic against the OTLP service names `marginmark-api-lle`, `marginmark-api-prod`, and `command-center`.

| Alert | Condition |
|---|---|
| API errors | 5xx rate > 2% for 5 minutes |
| Latency | p95 > 1.5 seconds |
| Parse failures | any surface > 10× its 7-day baseline |
| AI spend | daily spend > 80% of `AI_DAILY_BUDGET_USD` |
| Webhooks | any webhook failure in 15 minutes |

Export scrubs emails, tokens, Stripe ids, and request bodies before they leave the API.
