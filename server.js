import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "meefadmin";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ─── Data paths ────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const MENU_FILE = path.join(DATA_DIR, "menu.json");

// ─── Ensure data directory & seed files ────────────────────
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(ORDERS_FILE)) {
    writeJSON(ORDERS_FILE, []);
  }

  if (!fs.existsSync(MENU_FILE)) {
    writeJSON(MENU_FILE, {
      sizes: [
        { id: "full", label: "Full Turkey", price_cents: 5000, active: true },
        { id: "half", label: "Half Turkey", price_cents: 3000, active: true }
      ],
      flavors: [
        { id: "cajun", label: "Cajun", active: true },
        { id: "lemon-pepper", label: "Lemon Pepper", active: true },
        { id: "honey-mustard", label: "Honey Mustard", active: true },
        { id: "fajita", label: "Fajita", active: true }
      ],
      sides: [],
      extras: []
    });
  }

  if (!fs.existsSync(SETTINGS_FILE)) {
    writeJSON(SETTINGS_FILE, {
      business_name: "MEEF MEATS",
      tagline: "Pure Texas. Pure Turkey.",
      instagram_url: "",
      contact: { phone: "", email: "", address: "" },
      pickup_window: "07:00 AM - 10:30 AM",
      weeks_ahead: 3,
      status_overrides: {},
      notification_emails: [],
      telegram: {
        enabled: false,
        bot_token: "",
        chat_id: "",
        notify_new_orders: true,
        notify_status_changes: true
      },
      payment_methods: {
        venmo_enabled: true,
        venmo_username: "@MeefMeats",
        venmo_qr_url: "",
        zelle_enabled: true,
        zelle_info: "orders@meefmeats.com",
        cash_enabled: true,
        cash_instructions: "Bring exact change if possible",
        payment_note: "Your order is reserved but not confirmed until payment is received. Please complete payment within 24 hours."
      }
    });
  }
}

// ─── Robust JSON read/write ────────────────────────────────
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[readJSON] Error reading ${filePath}:`, err.message);
    // Return safe defaults based on file type
    if (filePath.includes("orders")) return [];
    if (filePath.includes("menu")) return { sizes: [], flavors: [], sides: [], extras: [] };
    return {};
  }
}

function writeJSON(filePath, data) {
  const tmpPath = filePath + ".tmp." + Date.now();
  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmpPath, json, "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch (err) {
    console.error(`[writeJSON] Error writing ${filePath}:`, err.message);
    // Clean up temp file if it exists
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    return false;
  }
}

// ─── Order persistence with retry ──────────────────────────
function saveOrder(order) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const orders = readJSON(ORDERS_FILE);
      orders.push(order);
      if (writeJSON(ORDERS_FILE, orders)) {
        console.log(`[saveOrder] Order ${order.id} saved on attempt ${attempt}`);
        return true;
      }
    } catch (err) {
      console.error(`[saveOrder] Attempt ${attempt} failed:`, err.message);
    }
    // Small delay between retries
    const delay = attempt * 100;
    const start = Date.now();
    while (Date.now() - start < delay) { /* busy wait for sync retry */ }
  }
  console.error(`[saveOrder] FAILED to save order ${order.id} after 3 attempts`);
  return false;
}

function updateOrderStatus(orderId, newStatus) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const orders = readJSON(ORDERS_FILE);
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx < 0) return { ok: false, error: "Order not found" };
      
      orders[idx].status = newStatus;
      orders[idx].updated_at = new Date().toISOString();
      
      if (writeJSON(ORDERS_FILE, orders)) {
        return { ok: true, order: orders[idx] };
      }
    } catch (err) {
      console.error(`[updateOrderStatus] Attempt ${attempt} failed:`, err.message);
    }
  }
  return { ok: false, error: "Failed to update after retries" };
}

// ─── Telegram notifications ────────────────────────────────
async function sendTelegramMessage(text) {
  const settings = readJSON(SETTINGS_FILE);
  const tg = settings.telegram || {};
  
  const token = tg.bot_token || TELEGRAM_BOT_TOKEN;
  const chatId = tg.chat_id || TELEGRAM_CHAT_ID;
  
  if (!tg.enabled || !token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML"
      })
    });
    console.log("[Telegram] Message sent");
  } catch (err) {
    console.error("[Telegram] Failed to send:", err.message);
  }
}

async function notifyNewOrder(order) {
  const items = order.items.map(i => `  ${i.qty}x ${i.size_label} - ${i.flavor}`).join("\n");
  const text = `🆕 <b>New Order: ${order.id}</b>\n\n👤 ${order.customer_name}\n📧 ${order.email}\n📱 ${order.phone}\n📅 Pickup: ${order.pickup_date}\n\n🛒 Items:\n${items}\n\n💰 Total: $${(order.total_cents / 100).toFixed(2)}`;
  await sendTelegramMessage(text);
}

async function notifyStatusChange(order) {
  const text = `📋 <b>Order ${order.id}</b> → <b>${order.status.toUpperCase()}</b>\n👤 ${order.customer_name}`;
  await sendTelegramMessage(text);
}

// ─── Email notifications ───────────────────────────────────
async function sendAdminNotification(order) {
  if (!resend) return;

  const settings = readJSON(SETTINGS_FILE);
  const emails = settings.notification_emails || [];
  if (emails.length === 0) return;

  const pickupDate = new Date(order.pickup_date + "T00:00:00");
  const itemsHTML = order.items.map(i => {
    return `<div style="padding:10px;background:#f9f9f9;border-radius:6px;margin:6px 0">${i.qty}x ${i.size_label} — ${i.flavor} ($${(i.line_total / 100).toFixed(2)})</div>`;
  }).join("");

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px"><div style="background:#000;color:#fff;padding:24px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:22px">🖐 New Order: ${order.id}</h1></div><div style="background:#fff;padding:24px;border-radius:0 0 10px 10px"><p><strong>Customer:</strong> ${order.customer_name}<br><strong>Email:</strong> ${order.email}<br><strong>Phone:</strong> ${order.phone}<br><strong>Pickup:</strong> ${pickupDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</p><h3>Items</h3>${itemsHTML}<div style="margin-top:16px;padding:16px;background:#000;color:#fff;border-radius:8px;text-align:center;font-size:24px;font-weight:900">Total: $${(order.total_cents/100).toFixed(2)}</div></div></div>`;

  for (const email of emails) {
    try {
      await resend.emails.send({
        from: "MEEF MEATS <onboarding@resend.dev>",
        to: email,
        subject: `New Order ${order.id} — $${(order.total_cents/100).toFixed(2)}`,
        html
      });
    } catch (err) {
      console.error(`[Email] Admin notification to ${email} failed:`, err.message);
    }
  }
}

async function sendCustomerConfirmation(order) {
  if (!resend) return;

  const settings = readJSON(SETTINGS_FILE);
  const payment = settings.payment_methods || {};
  const pickupDate = new Date(order.pickup_date + "T00:00:00");
  const total = "$" + (order.total_cents / 100).toFixed(2);

  const itemsHTML = order.items.map(i => {
    return `<div style="margin:6px 0;padding:12px;background:#f9f9f9;border-radius:8px"><strong>${i.qty}x ${i.size_label}</strong><br><span style="color:#666">Flavor: ${i.flavor} • ${("$"+(i.line_total/100).toFixed(2))}</span></div>`;
  }).join("");

  let payHTML = "";
  if (payment.venmo_enabled) {
    payHTML += `<div style="margin-bottom:14px;padding:14px;background:#f0f8ff;border-left:4px solid #3d95ce;border-radius:4px"><strong style="color:#3d95ce">Venmo:</strong> Send ${total} to <strong>${payment.venmo_username||"@MeefMeats"}</strong>`;
    if (payment.venmo_qr_url) {
      payHTML += `<br><img src="${payment.venmo_qr_url}" alt="Venmo QR" style="margin-top:8px;max-width:180px;border-radius:8px">`;
    }
    payHTML += `</div>`;
  }
  if (payment.zelle_enabled) {
    payHTML += `<div style="margin-bottom:14px;padding:14px;background:#f5f0ff;border-left:4px solid #6d1ed4;border-radius:4px"><strong style="color:#6d1ed4">Zelle:</strong> Send ${total} to <strong>${payment.zelle_info||"orders@meefmeats.com"}</strong></div>`;
  }
  if (payment.cash_enabled) {
    payHTML += `<div style="margin-bottom:14px;padding:14px;background:#f0fff4;border-left:4px solid #9ae6b4;border-radius:4px"><strong style="color:#16a34a">Cash:</strong> Pay ${total} at pickup${payment.cash_instructions ? "<br><small>"+payment.cash_instructions+"</small>" : ""}</div>`;
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f5f5f5;padding:20px"><div style="background:#000;color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0"><div style="font-size:32px">🖐</div><h2 style="margin:10px 0 0">Order Confirmed!</h2></div><div style="background:#fff;padding:24px;border-radius:0 0 10px 10px"><div style="background:#f9f9f9;padding:16px;border-radius:8px;text-align:center;margin-bottom:20px"><div style="font-size:12px;color:#666">Order Number</div><div style="font-size:22px;font-weight:900">${order.id}</div></div>${itemsHTML}<div style="margin:20px 0;padding:20px;background:#000;color:#fff;border-radius:8px;text-align:center;font-size:28px;font-weight:900">${total}</div><h3>Pickup Details</h3><div style="background:#f9f9f9;padding:14px;border-radius:8px"><p>📅 ${pickupDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</p><p>🕐 ${settings.pickup_window || "7:00 AM - 10:30 AM"}</p></div><h3 style="margin-top:20px">Payment</h3>${payHTML}${payment.payment_note ? `<div style="background:#fff9e6;border:1px solid #ffd966;border-radius:8px;padding:14px;margin-top:14px;font-size:13px;color:#666"><strong>⚠️ ${payment.payment_note}</strong></div>` : ""}</div></div>`;

  try {
    await resend.emails.send({
      from: "MEEF MEATS <onboarding@resend.dev>",
      to: order.email,
      subject: `Order Confirmation — ${order.id}`,
      html
    });
    console.log(`[Email] Customer confirmation sent to ${order.email}`);
  } catch (err) {
    console.error(`[Email] Customer confirmation failed:`, err.message);
  }
}

// ─── Date generation ───────────────────────────────────────
function generateAllowedDates() {
  const settings = readJSON(SETTINGS_FILE);
  const weeksAhead = settings.weeks_ahead || 3;
  
  const today = new Date();
  const target = new Date(today);
  target.setDate(today.getDate() + weeksAhead * 7);

  const dow = target.getDay();
  let daysToFriday = (5 - dow + 7) % 7;
  if (daysToFriday === 0 && dow !== 5) daysToFriday = 7;

  const friday = new Date(target);
  friday.setDate(target.getDate() + daysToFriday);

  const sat = new Date(friday);
  sat.setDate(friday.getDate() + 1);
  const sun = new Date(friday);
  sun.setDate(friday.getDate() + 2);

  return [friday, sat, sun].map(d => d.toISOString().split("T")[0]);
}

// ─── Auth middleware ────────────────────────────────────────
function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from("admin:" + ADMIN_PASSWORD).toString("base64");
  if (auth === expected) return next();
  res.set("WWW-Authenticate", 'Basic realm="MEEF Admin"');
  return res.status(401).send("Authentication required.");
}

// ─── Initialize ────────────────────────────────────────────
ensureDataFiles();
app.use(express.json({ limit: "5mb" }));

// ═══════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════

app.get("/api/allowed-dates", (req, res) => {
  try {
    res.json(generateAllowedDates());
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to generate dates" });
  }
});

app.get("/api/settings", (req, res) => {
  try {
    const s = readJSON(SETTINGS_FILE);
    res.json({
      business_name: s.business_name || "MEEF MEATS",
      tagline: s.tagline || "",
      payment_methods: s.payment_methods || {},
      contact: s.contact || {},
      instagram_url: s.instagram_url || "",
      pickup_window: s.pickup_window || "07:00 AM - 10:30 AM"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

app.get("/api/menu", (req, res) => {
  try {
    const menu = readJSON(MENU_FILE);
    // Only return active items to the public
    res.json({
      sizes: (menu.sizes || []).filter(s => s.active),
      flavors: (menu.flavors || []).filter(f => f.active),
      sides: (menu.sides || []).filter(s => s.active),
      extras: (menu.extras || []).filter(e => e.active)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load menu" });
  }
});

app.post("/api/orders", async (req, res) => {
  const body = req.body || {};

  // Validate required fields
  if (!body.customer_name || body.customer_name.length > 100) {
    return res.status(400).json({ ok: false, error: "Valid name is required" });
  }
  if (!body.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return res.status(400).json({ ok: false, error: "Valid email is required" });
  }
  if (!body.phone) {
    return res.status(400).json({ ok: false, error: "Phone number is required" });
  }
  if (!body.pickup_date) {
    return res.status(400).json({ ok: false, error: "Pickup date is required" });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ ok: false, error: "Cart is empty" });
  }

  // Validate pickup date is in allowed list
  const allowedDates = generateAllowedDates();
  if (!allowedDates.includes(body.pickup_date)) {
    return res.status(400).json({ ok: false, error: "Invalid pickup date" });
  }

  try {
    // Load current menu for price validation
    const menu = readJSON(MENU_FILE);
    const sizeMap = {};
    for (const s of menu.sizes || []) {
      if (s.active) sizeMap[s.id] = s;
    }

    // Build validated items with server-side pricing
    const items = [];
    let totalCents = 0;

    for (const item of body.items) {
      const sizeInfo = sizeMap[item.size];
      if (!sizeInfo) {
        return res.status(400).json({ ok: false, error: `Invalid size: ${item.size}` });
      }

      const qty = Math.max(1, Math.min(50, parseInt(item.qty) || 1));
      const lineTotal = sizeInfo.price_cents * qty;
      totalCents += lineTotal;

      items.push({
        size: item.size,
        size_label: sizeInfo.label,
        flavor: item.flavor || "Original",
        qty,
        unit_price: sizeInfo.price_cents,
        line_total: lineTotal
      });
    }

    const order = {
      id: "ORD-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "new",
      total_cents: totalCents,
      customer_name: body.customer_name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      pickup_date: body.pickup_date,
      items,
      notes: (body.notes || "").slice(0, 500)
    };

    // CRITICAL: Save order FIRST, emails are secondary
    const saved = saveOrder(order);
    if (!saved) {
      return res.status(500).json({ ok: false, error: "Failed to save order. Please try again." });
    }

    // Return success immediately — emails happen in background
    res.json({ ok: true, order_id: order.id, total_cents: totalCents });

    // Fire-and-forget: emails + telegram
    (async () => {
      try { await sendAdminNotification(order); } catch (e) { console.error("[bg] Admin email failed:", e.message); }
      try { await sendCustomerConfirmation(order); } catch (e) { console.error("[bg] Customer email failed:", e.message); }
      try { await notifyNewOrder(order); } catch (e) { console.error("[bg] Telegram failed:", e.message); }
    })();

  } catch (err) {
    console.error("[POST /api/orders] Error:", err);
    res.status(500).json({ ok: false, error: "Server error creating order" });
  }
});

app.get("/api/track/:orderId", (req, res) => {
  try {
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id.toUpperCase() === req.params.orderId.toUpperCase());
    if (!order) return res.status(404).json({ ok: false, error: "Order not found" });
    res.json({
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        pickup_date: order.pickup_date,
        items: order.items,
        total_cents: order.total_cents,
        created_at: order.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to look up order" });
  }
});

// ═══════════════════════════════════════════════════════════
//  ADMIN API
// ═══════════════════════════════════════════════════════════

// Serve admin pages
app.get("/admin", basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "admin.html"));
});

// Admin orders
app.get("/api/admin/orders", basicAuth, (req, res) => {
  try {
    const orders = readJSON(ORDERS_FILE);
    res.json({ ok: true, orders });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
  }
});

app.put("/api/admin/orders/:id/status", basicAuth, async (req, res) => {
  const valid = ["new", "confirmed", "preparing", "cooking", "ready", "picked_up", "canceled"];
  if (!valid.includes(req.body.status)) {
    return res.status(400).json({ ok: false, error: "Invalid status" });
  }

  const result = updateOrderStatus(req.params.id, req.body.status);
  if (!result.ok) return res.status(result.error === "Order not found" ? 404 : 500).json(result);

  res.json(result);

  // Notify via telegram in background
  try { await notifyStatusChange(result.order); } catch (_) {}
});

app.delete("/api/admin/orders/:id", basicAuth, (req, res) => {
  try {
    const orders = readJSON(ORDERS_FILE);
    const filtered = orders.filter(o => o.id !== req.params.id);
    if (filtered.length === orders.length) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    if (!writeJSON(ORDERS_FILE, filtered)) {
      return res.status(500).json({ ok: false, error: "Failed to delete order" });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to delete order" });
  }
});

// Admin settings
app.get("/api/admin/settings", basicAuth, (req, res) => {
  try {
    res.json(readJSON(SETTINGS_FILE));
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

app.put("/api/admin/settings", basicAuth, (req, res) => {
  try {
    const existing = readJSON(SETTINGS_FILE);
    const patch = req.body || {};

    const merged = {
      business_name: patch.business_name !== undefined ? patch.business_name : existing.business_name,
      tagline: patch.tagline !== undefined ? patch.tagline : existing.tagline,
      instagram_url: patch.instagram_url !== undefined ? patch.instagram_url : existing.instagram_url,
      contact: { ...existing.contact, ...(patch.contact || {}) },
      pickup_window: patch.pickup_window !== undefined ? patch.pickup_window : existing.pickup_window,
      weeks_ahead: patch.weeks_ahead !== undefined ? patch.weeks_ahead : existing.weeks_ahead,
      status_overrides: { ...existing.status_overrides, ...(patch.status_overrides || {}) },
      notification_emails: patch.notification_emails !== undefined ? patch.notification_emails : existing.notification_emails,
      telegram: { ...existing.telegram, ...(patch.telegram || {}) },
      payment_methods: { ...existing.payment_methods, ...(patch.payment_methods || {}) }
    };

    if (!writeJSON(SETTINGS_FILE, merged)) {
      return res.status(500).json({ ok: false, error: "Failed to save" });
    }
    res.json({ ok: true, settings: merged });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to update settings" });
  }
});

// Admin menu management
app.get("/api/admin/menu", basicAuth, (req, res) => {
  try {
    res.json(readJSON(MENU_FILE));
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to load menu" });
  }
});

app.put("/api/admin/menu", basicAuth, (req, res) => {
  try {
    const menu = req.body;
    if (!menu || !Array.isArray(menu.sizes) || !Array.isArray(menu.flavors)) {
      return res.status(400).json({ ok: false, error: "Invalid menu data" });
    }
    if (!writeJSON(MENU_FILE, menu)) {
      return res.status(500).json({ ok: false, error: "Failed to save menu" });
    }
    res.json({ ok: true, menu });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to update menu" });
  }
});

// ─── Static files ──────────────────────────────────────────
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback — serve index for non-api, non-admin routes
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start server ──────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`MEEF MEATS running on port ${PORT}`);
  console.log(`Resend: ${resend ? "configured" : "not configured"}`);
  console.log(`Telegram: ${TELEGRAM_BOT_TOKEN ? "configured" : "not configured"}`);
});
