import express from "express";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
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
const STAY_LIKES_FILE = path.join(DATA_DIR, "stay-likes.json");
const STAY_CACHE_FILE = path.join(DATA_DIR, "stay-cache.json");
const RITZ_CARLTON_DALLAS = { lat: 32.79252, lon: -96.80531 };
const STAY_CACHE_TTL_MS = 2 * 60 * 1000;

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

  if (!fs.existsSync(STAY_LIKES_FILE)) {
    writeJSON(STAY_LIKES_FILE, []);
  }
  if (!fs.existsSync(STAY_CACHE_FILE)) {
    writeJSON(STAY_CACHE_FILE, { updated_at: null, listings: [] });
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

function distanceMiles(a, b) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function textFromHTML(input = "") {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDuckDuckGoUrl(rawUrl = "") {
  const cleaned = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
  const parsed = new URL(cleaned, "https://duckduckgo.com");
  const target = parsed.searchParams.get("uddg");
  return target ? decodeURIComponent(target) : cleaned;
}

function stableId(source, text) {
  return `${source}-${Buffer.from(text).toString("hex").slice(0, 18)}`;
}

function parseSearchResults(html, source) {
  const cards = [];
  const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = resultRegex.exec(html)) !== null) {
    const url = unwrapDuckDuckGoUrl(match[1]);
    const name = textFromHTML(match[2]);
    const trailing = html.slice(match.index, match.index + 1200);
    const snippetMatch = trailing.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const snippet = textFromHTML(snippetMatch?.[1] || snippetMatch?.[2] || "");

    const priceMatch = snippet.match(/(?:US\$|\$)\s?(\d{2,4})/i) || name.match(/(?:US\$|\$)\s?(\d{2,4})/i);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1]);

    const distMatch = snippet.match(/(\d+(?:\.\d+)?)\s*(?:mile|mi)\b/i);
    const distance = distMatch ? Number(distMatch[1]) : null;
    const id = stableId(source, `${url}-${name}`);

    cards.push({
      id,
      source,
      name,
      price,
      distance_miles: distance,
      rating: null,
      location: "Dallas, TX",
      summary: snippet || "Live search result",
      url
    });
  }

  return cards;
}

async function fetchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const output = execSync(
    `curl -sSL --max-time 20 -A "Mozilla/5.0" "${url}"`,
    { encoding: "utf8" }
  );
  if (!output || output.length < 100) throw new Error("DuckDuckGo returned empty response");
  return output;
}

async function runLiveStayScan() {
  const [hotelA, hotelB, airbnbA, airbnbB] = await Promise.all([
    fetchDuckDuckGo("site:booking.com Dallas hotel near Ritz Carlton US$ under 300"),
    fetchDuckDuckGo("site:hotels.com Dallas downtown hotel $ per night"),
    fetchDuckDuckGo("site:airbnb.com/rooms Dallas TX $ per night"),
    fetchDuckDuckGo("airbnb dallas near ritz carlton under $260")
  ]);

  const hotelListings = [...parseSearchResults(hotelA, "hotel"), ...parseSearchResults(hotelB, "hotel")]
    .filter(item => item.price <= 300 && (item.distance_miles == null || item.distance_miles <= 10));
  const airbnbListings = [...parseSearchResults(airbnbA, "airbnb"), ...parseSearchResults(airbnbB, "airbnb")]
    .filter(item => item.price <= 260 && (item.distance_miles == null || item.distance_miles <= 10));

  const merged = [...hotelListings, ...airbnbListings];
  const uniq = new Map();
  for (const item of merged) {
    if (!uniq.has(item.url)) uniq.set(item.url, item);
  }

  return Array.from(uniq.values()).sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return (a.distance_miles ?? 999) - (b.distance_miles ?? 999);
  });
}

async function refreshStayCache(force = false) {
  const cache = readJSON(STAY_CACHE_FILE);
  const lastUpdated = cache.updated_at ? new Date(cache.updated_at).getTime() : 0;
  const expired = !lastUpdated || (Date.now() - lastUpdated) > STAY_CACHE_TTL_MS;

  if (!force && !expired && Array.isArray(cache.listings) && cache.listings.length) {
    return cache;
  }

  const listings = await runLiveStayScan();
  const next = { updated_at: new Date().toISOString(), listings };
  writeJSON(STAY_CACHE_FILE, next);
  return next;
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

refreshStayCache(true).catch(err => {
  console.error("[stays] Initial live scan failed:", err.message);
});
setInterval(() => {
  refreshStayCache(true).catch(err => {
    console.error("[stays] Rolling scan failed:", err.message);
  });
}, STAY_CACHE_TTL_MS);

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

app.get("/api/stays/scan", async (req, res) => {
  try {
    const force = req.query.force === "1";
    const minMiles = Number(req.query.minMiles ?? 0);
    const maxMiles = Number(req.query.maxMiles ?? 10);
    const cache = await refreshStayCache(force);
    const listings = (cache.listings || []).filter(item => {
      const d = item.distance_miles;
      if (d == null) return true;
      return d >= minMiles && d <= maxMiles;
    });

    res.json({
      ok: true,
      center: { name: "The Ritz-Carlton, Dallas", ...RITZ_CARLTON_DALLAS },
      constraints: { hotel_max_price: 300, airbnb_max_price: 260, min_miles: minMiles, max_miles: maxMiles },
      scanned_at: cache.updated_at,
      live: true,
      listings
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed live scan", detail: err.message });
  }
});

app.get("/api/stays/likes", (req, res) => {
  const likes = readJSON(STAY_LIKES_FILE);
  res.json({ ok: true, likes: Array.isArray(likes) ? likes : [] });
});

app.post("/api/stays/likes", (req, res) => {
  const listing = req.body?.listing;
  if (!listing || !listing.id) return res.status(400).json({ ok: false, error: "listing.id required" });

  const likes = readJSON(STAY_LIKES_FILE);
  const arr = Array.isArray(likes) ? likes : [];
  if (!arr.some(item => item.id === listing.id)) {
    arr.push(listing);
    writeJSON(STAY_LIKES_FILE, arr);
  }

  res.json({ ok: true, likes: arr });
});

app.delete("/api/stays/likes/:id", (req, res) => {
  const likes = readJSON(STAY_LIKES_FILE);
  const arr = Array.isArray(likes) ? likes : [];
  const filtered = arr.filter(item => item.id !== req.params.id);
  writeJSON(STAY_LIKES_FILE, filtered);
  res.json({ ok: true, likes: filtered });
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

app.get("/stays", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "stays", "index.html"));
});

// ─── Static files ──────────────────────────────────────────
app.use("/assets", express.static(path.join(__dirname, "public", "assets")));
app.use("/stays", express.static(path.join(__dirname, "public", "stays")));
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
