-- Read-only Grafana role. Run as a Neon admin. Do not grant this role table writes.

CREATE ROLE grafana_ro LOGIN PASSWORD 'replace-me';
-- GRANT CONNECT ON DATABASE your_neon_db TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON
  v_daily_signups,
  v_mrr,
  v_trials,
  v_plan_counts,
  v_funnel_30d,
  v_scrape_success_daily,
  v_ext_versions_7d,
  v_ai_spend_daily,
  v_trends_weekly
TO grafana_ro;
