(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const panel = byId("panel");
  let adminKey = sessionStorage.getItem("opsAdminKey") || "";
  let telemetryKey = sessionStorage.getItem("opsTelemetryKey") || "";

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }

  function clear(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  async function api(path, telemetry = false) {
    const headers = telemetry
      ? { "X-Telemetry-Key": telemetryKey }
      : { "X-Admin-Key": adminKey };
    const response = await fetch(path, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed");
    return body;
  }

  function table(headers, rows) {
    const wrapper = node("div", undefined, "table-wrap");
    const element = node("table");
    const head = node("thead");
    const headRow = node("tr");
    headers.forEach((header) => headRow.appendChild(node("th", header)));
    head.appendChild(headRow);
    element.appendChild(head);
    const body = node("tbody");
    rows.forEach((values) => {
      const row = node("tr");
      values.forEach((value) => row.appendChild(node("td", value ?? "")));
      body.appendChild(row);
    });
    element.appendChild(body);
    wrapper.appendChild(element);
    return wrapper;
  }

  async function overview() {
    const data = await api("/admin/overview");
    clear(panel);
    const card = node("div", undefined, "card");
    card.appendChild(
      node("p", `${data.users} users · ${data.pro_rows} active subscriptions · ${data.app_env}`),
    );
    card.appendChild(node("p", `Services: ${(data.services || []).join(", ")}`, "ok"));
    panel.appendChild(card);
  }

  async function users() {
    const data = await api("/admin/users");
    clear(panel);
    const rows = (data.users || []).map((user) => [
      user.id,
      user.email,
      user.plan || "free",
      user.status || "free",
      user.stripe_sub_id ? "Stripe" : user.status === "active" && !user.promo_expires_at ? "Manual grant" : "",
      user.promo_expires_at || "",
    ]);
    panel.appendChild(table(["id", "email", "plan (what the app shows)", "status", "billing", "promo expires"], rows));
  }

  async function database() {
    const data = await api("/admin/db/tables");
    clear(panel);
    panel.appendChild(
      table(
        ["table", "rows"],
        (data.tables || []).map((entry) => [entry.table, entry.rows]),
      ),
    );
    panel.appendChild(node("p", "Database browsing is read-only in production.", "ok"));
  }

  async function telemetry() {
    const [summary, events] = await Promise.all([
      api("/admin/telemetry/summary?days=7", true),
      api("/admin/telemetry/events?limit=80", true),
    ]);
    clear(panel);
    panel.appendChild(
      table(
        ["event", "count"],
        (summary.counts || []).map((entry) => [entry.event, entry.n]),
      ),
    );
    panel.appendChild(
      table(
        ["time", "event", "user id", "properties"],
        (events.events || []).map((event) => [
          event.ts,
          event.event,
          event.user_id || "",
          JSON.stringify(event.properties || {}).slice(0, 240),
        ]),
      ),
    );
  }

  async function promos() {
    const data = await api("/admin/promos");
    clear(panel);
    panel.appendChild(
      table(
        ["code", "days", "uses", "active"],
        (data.promos || []).map((promo) => [
          promo.code,
          promo.duration_days,
          `${promo.redeemed_count}/${promo.max_redemptions ?? "unlimited"}`,
          promo.active ? "yes" : "no",
        ]),
      ),
    );
  }

  async function config() {
    const response = await fetch("/config/remote?service=tiktok-seller-tool");
    const data = await response.json();
    clear(panel);
    const card = node("div", undefined, "card");
    card.appendChild(node("pre", JSON.stringify(data, null, 2)));
    panel.appendChild(card);
  }

  async function dashboard() {
    const data = await api("/admin/metrics/summary");
    clear(panel);
    const tiles = [
      ["MRR", data.mrr_usd],
      ["Paying", data.paying],
      ["Trialing", data.trialing],
      ["Trials ending", data.ending_3d],
    ];
    tiles.forEach((pair) => {
      const card = node("div", undefined, "card");
      card.appendChild(node("p", pair[0]));
      card.appendChild(node("strong", pair[1]));
      panel.appendChild(card);
    });
    panel.appendChild(node("pre", JSON.stringify(data, null, 2)));
  }

  const loaders = { overview, users, database, telemetry, promos, config, dashboard };
  async function show(name) {
    document.querySelectorAll(".tab[data-tab]").forEach((button) => {
      button.classList.toggle("on", button.dataset.tab === name);
    });
    try {
      await loaders[name]();
    } catch (error) {
      clear(panel);
      panel.appendChild(node("p", error instanceof Error ? error.message : "Request failed", "err"));
    }
  }

  byId("unlock").addEventListener("click", async () => {
    adminKey = byId("key").value.trim();
    telemetryKey = byId("telemetryKey").value.trim();
    try {
      await api("/admin/overview");
      sessionStorage.setItem("opsAdminKey", adminKey);
      sessionStorage.setItem("opsTelemetryKey", telemetryKey);
      byId("login").hidden = true;
      byId("app").hidden = false;
      await show("overview");
    } catch (error) {
      byId("loginMsg").textContent =
        error instanceof Error ? error.message : "Request failed";
    }
  });

  document.querySelectorAll(".tab[data-tab]").forEach((button) => {
    button.addEventListener("click", () => void show(button.dataset.tab));
  });
  if (adminKey) {
    byId("key").value = adminKey;
    byId("telemetryKey").value = telemetryKey;
    byId("unlock").click();
  }
})();
