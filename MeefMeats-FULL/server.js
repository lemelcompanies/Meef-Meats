import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "meefadmin";

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        instagram_url: "",
        contact: { phone: "", email: "", address: "" },
        status_overrides: {}
      },
      null,
      2
    )
  );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from("admin:" + ADMIN_PASSWORD).toString("base64");
  if (auth === expected) return next();
  res.set("WWW-Authenticate", "Basic realm=\"MEEF Admin\"");
  return res.status(401).send("Authentication required.");
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

function allowedDatesISO() {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  const toFriday = (5 - base.getDay() + 7) % 7; // Fri = 5
  const fri = new Date(base); fri.setDate(base.getDate() + toFriday);
  const sat = new Date(fri); sat.setDate(fri.getDate() + 1);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
  const f = (d) => d.toISOString().slice(0, 10);
  return [f(fri), f(sat), f(sun)];
}

/** Public APIs **/
app.get("/api/allowed-dates", (req, res) => res.json(allowedDatesISO()));

app.get("/api/products", (req, res) => {
  res.json([{
    id: "turkey",
    name: "Turkey",
    description: "Full Texas turkey or 1/2 Texas turkey. Choose your flavor.",
    flavors: ["Cajun", "Lemon Pepper", "Honey Mustard", "Fajita"],
    price_full: 5000,
    price_half: 3000
  }]);
});

app.get("/api/settings", (req, res) => {
  res.json(readJSON(SETTINGS_FILE));
});

app.get("/api/availability", (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ ok: false, error: "Missing date" });
  const s = readJSON(SETTINGS_FILE);
  const ov = (s.status_overrides && s.status_overrides[date]) || {};
  res.json({
    cap_full: 30,
    cap_half: 10,
    remaining_full: ov.full === "out" ? 0 : 20,
    remaining_half: ov.half === "out" ? 0 : 8,
    status_full: ov.full || "ok",
    status_half: ov.half || "ok"
  });
});

app.post("/api/orders", (req, res) => {
  const o = req.body || {};
  if (!o.customer_name || !o.email || !o.pickup_date || !Array.isArray(o.items) || o.items.length === 0) {
    return res.status(400).json({ ok: false, error: "Invalid order" });
  }
  const total = o.items.reduce((s, it) => s + (it.size === "half" ? 3000 : 5000) * (it.qty || 1), 0);
  const orders = readJSON(ORDERS_FILE);
  const order = {
    id: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
    created_at: new Date().toISOString(),
    status: "new",
    total_cents: total,
    ...o
  };
  orders.push(order);
  writeJSON(ORDERS_FILE, orders);
  res.json({ ok: true, order_id: order.id, total_cents: total });
});

/** Admin site + APIs **/
app.use("/admin", basicAuth, express.static(path.join(__dirname, "public", "admin")));

app.get("/api/admin/orders", basicAuth, (req, res) => {
  res.json({ ok: true, orders: readJSON(ORDERS_FILE) });
});

app.put("/api/admin/orders/:id/status", basicAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ["new", "confirmed", "preparing", "ready", "picked_up", "canceled"];
  if (!allowed.includes(status)) return res.status(400).json({ ok: false, error: "Bad status" });
  const orders = readJSON(ORDERS_FILE);
  const i = orders.findIndex((o) => o.id === id);
  if (i < 0) return res.status(404).json({ ok: false, error: "Not found" });
  orders[i].status = status;
  writeJSON(ORDERS_FILE, orders);
  res.json({ ok: true, order: orders[i] });
});

app.get("/api/admin/settings", basicAuth, (req, res) => {
  res.json(readJSON(SETTINGS_FILE));
});

app.put("/api/admin/settings", basicAuth, (req, res) => {
  const existing = readJSON(SETTINGS_FILE);
  const patch = req.body || {};
  const merged = {
    ...existing,
    instagram_url: patch.instagram_url ?? existing.instagram_url,
    contact: { ...existing.contact, ...(patch.contact || {}) },
    status_overrides: { ...existing.status_overrides, ...(patch.status_overrides || {}) }
  };
  writeJSON(SETTINGS_FILE, merged);
  res.json({ ok: true, settings: merged });
});

app.listen(PORT, () => {
  console.log(`MEEF MEATS running on http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin (Basic Auth username: admin, password from ADMIN_PASSWORD)`);
});
