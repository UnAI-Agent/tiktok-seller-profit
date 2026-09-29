"""Tables added for v1. Statements are constant SQL."""

V1_TABLES = (
    """
    CREATE TABLE IF NOT EXISTS signed_remote_config (
        service TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS product_insights (
        product_id TEXT PRIMARY KEY,
        summary_json TEXT NOT NULL,
        review_count_at INTEGER NOT NULL,
        rating_at REAL NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        source_submissions INTEGER NOT NULL DEFAULT 0,
        provisional INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS insight_submissions (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        week_token TEXT NOT NULL,
        review_count INTEGER NOT NULL,
        rating REAL NOT NULL,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ai_usage (
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, month)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS ai_spend (
        day TEXT PRIMARY KEY,
        usd REAL NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS product_events (
        id TEXT PRIMARY KEY,
        event TEXT NOT NULL,
        product_id TEXT NOT NULL,
        week_token TEXT NOT NULL,
        day TEXT NOT NULL,
        price REAL,
        sold_count REAL,
        rating REAL,
        review_count INTEGER,
        category_path TEXT,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS product_snapshots (
        product_id TEXT NOT NULL,
        day TEXT NOT NULL,
        price REAL,
        sold_count REAL,
        rating REAL,
        review_count INTEGER,
        PRIMARY KEY (product_id, day)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS product_weekly (
        week TEXT NOT NULL,
        product_id TEXT NOT NULL,
        lookups INTEGER NOT NULL,
        distinct_tokens INTEGER NOT NULL,
        adds INTEGER NOT NULL,
        removes INTEGER NOT NULL,
        sold_delta REAL,
        price_p50 REAL,
        PRIMARY KEY (week, product_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS admin_audit (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS support_notes (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS parse_failures (
        day TEXT NOT NULL,
        surface TEXT NOT NULL,
        field TEXT NOT NULL,
        selector_version TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, surface, field, selector_version)
    )
    """,
)
