CREATE OR REPLACE VIEW v_daily_signups AS
SELECT date(created_at) AS day, COUNT(*) AS signups
FROM users
GROUP BY date(created_at);

CREATE OR REPLACE VIEW v_mrr AS
SELECT COALESCE(SUM(CASE WHEN interval='year' THEN amount_cents/12.0 ELSE amount_cents END),0)/100.0 AS mrr_usd,
       COUNT(*) AS paying
FROM subscriptions WHERE stripe_status='active';

CREATE OR REPLACE VIEW v_trials AS
SELECT COUNT(*) FILTER (WHERE stripe_status='trialing') AS trialing,
       COUNT(*) FILTER (WHERE stripe_status='trialing' AND current_period_end < NOW() + INTERVAL '3 days') AS ending_3d
FROM subscriptions;

CREATE OR REPLACE VIEW v_plan_counts AS
SELECT CASE WHEN s.stripe_status IN ('active','trialing')
              OR (s.status='active' AND s.stripe_sub_id IS NULL
                  AND (s.promo_expires_at IS NULL OR s.promo_expires_at > NOW()))
            THEN COALESCE(s.tier,'pro') ELSE 'free' END AS plan,
       COUNT(*) AS users
FROM users u LEFT JOIN subscriptions s ON s.user_id=u.id AND s.service='tiktok-seller-tool'
GROUP BY 1;

CREATE OR REPLACE VIEW v_funnel_30d AS
SELECT event, COUNT(DISTINCT user_id) AS users FROM telemetry_events
WHERE ts > NOW() - INTERVAL '30 days'
  AND event IN ('user.registered','overlay.shown','cost.first_entered','upgrade.clicked','checkout.created','subscription.state_changed')
GROUP BY event;

CREATE OR REPLACE VIEW v_scrape_success_daily AS
SELECT date(ts) AS day, payload_json::json->>'pageType' AS page_type,
       AVG(CASE WHEN payload_json::json->>'priceFound'='true' THEN 1 ELSE 0 END) AS price_rate,
       COUNT(*) AS n
FROM telemetry_events WHERE event='scrape.result' GROUP BY 1,2;

CREATE OR REPLACE VIEW v_ext_versions_7d AS
SELECT payload_json::json->>'extVersion' AS version, COUNT(*) AS events
FROM telemetry_events WHERE ts > NOW() - INTERVAL '7 days' GROUP BY 1;

CREATE OR REPLACE VIEW v_ai_spend_daily AS
SELECT day, usd FROM ai_spend;

CREATE OR REPLACE VIEW v_trends_weekly AS
SELECT week, product_id, lookups, distinct_tokens, adds, removes, sold_delta, price_p50
FROM product_weekly
WHERE distinct_tokens >= 5;
