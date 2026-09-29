# Grafana

1. Create a Grafana Cloud stack.
2. Run `ops/grafana/views.sql` on the Neon branch, then `ops/grafana/roles.sql` with a real password.
3. Add the Neon database as a Postgres data source using `grafana_ro`.
4. Import `ops/grafana/dashboards/marginmark.json` into a `MarginMark` folder.
5. For another product, add its read-only data source and copy the folder. An `ALL Products` folder can add one query per data source.
