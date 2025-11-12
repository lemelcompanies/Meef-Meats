import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "meefadmin";

// Data storage paths
const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

// Initialize data directory and files
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
}

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({
      instagram_url: "",
      contact: { phone: "", email: "", address: "" },
      status_overrides: {}
    }, null, 2),
    "utf8"
  );
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Basic Auth middleware for admin routes
function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from("admin:" + ADMIN_PASSWORD).toString("base64");
  
  if (auth === expected) {
    return next();
  }
  
  res.set("WWW-Authenticate", 'Basic realm="MEEF Admin"');
  return res.status(401).send("Authentication required.");
}

// File operations with error handling
function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return filePath.includes("orders") ? [] : {};
  }
}

function writeJSON(filePath, data) {
  try {
    // Atomic write using temp file
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    return false;
  }
}

// Calculate allowed pickup dates (exactly 3 weeks out, Fri-Sun)
function allowedDatesISO() {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  
  // Find next Friday (or the Friday 7 days later if base is already Friday)
  const daysUntilFriday = (5 - base.getDay() + 7) % 7;
  const finalDaysToAdd = daysUntilFriday === 0 ? 7 : daysUntilFriday;
  
  const fri = new Date(base);
  fri.setDate(base.getDate() + finalDaysToAdd);
  
  const sat = new Date(fri);
  sat.setDate(fri.getDate() + 1);
  
  const sun = new Date(fri);
  sun.setDate(fri.getDate() + 2);
  
  const formatDate = (d) => d.toISOString().slice(0, 10);
  
  return [formatDate(fri), formatDate(sat), formatDate(sun)];
}

/** PUBLIC API ROUTES **/

// Get allowed pickup dates
app.get("/api/allowed-dates", (req, res) => {
  try {
    res.json(allowedDatesISO());
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to calculate dates" });
  }
});

// Get products
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

// Get public settings
app.get("/api/settings", (req, res) => {
  try {
    const settings = readJSON(SETTINGS_FILE);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

// Get availability for a specific date
app.get("/api/availability", (req, res) => {
  const date = req.query.date;
  
  if (!date) {
    return res.status(400).json({ ok: false, error: "Missing date parameter" });
  }
  
  try {
    const settings = readJSON(SETTINGS_FILE);
    const overrides = (settings.status_overrides && settings.status_overrides[date]) || {};
    
    res.json({
      cap_full: 30,
      cap_half: 10,
      remaining_full: overrides.full === "out" ? 0 : 20,
      remaining_half: overrides.half === "out" ? 0 : 8,
      status_full: overrides.full || "ok",
      status_half: overrides.half || "ok"
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to check availability" });
  }
});

// Create new order
app.post("/api/orders", (req, res) => {
  const orderData = req.body || {};
  
  // Validate required fields
  if (!orderData.customer_name || orderData.customer_name.length > 100) {
    return res.status(400).json({ ok: false, error: "Invalid customer name" });
  }
  
  // Simple email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!orderData.email || !emailRegex.test(orderData.email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address" });
  }
  
  if (!orderData.pickup_date) {
    return res.status(400).json({ ok: false, error: "Missing pickup date" });
  }
  
  if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
    return res.status(400).json({ ok: false, error: "Cart is empty" });
  }
  
  try {
    // Calculate total
    const total = orderData.items.reduce((sum, item) => {
      const price = item.size === "half" ? 3000 : 5000;
      const qty = item.qty || 1;
      return sum + (price * qty);
    }, 0);
    
    // Create order object
    const order = {
      id: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      created_at: new Date().toISOString(),
      status: "new",
      total_cents: total,
      customer_name: orderData.customer_name,
      email: orderData.email,
      phone: orderData.phone || "",
      pickup_date: orderData.pickup_date,
      items: orderData.items
    };
    
    // Save order
    const orders = readJSON(ORDERS_FILE);
    orders.push(order);
    
    if (!writeJSON(ORDERS_FILE, orders)) {
      return res.status(500).json({ ok: false, error: "Failed to save order" });
    }
    
    res.json({ ok: true, order_id: order.id, total_cents: total });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ ok: false, error: "Failed to create order" });
  }
});

/** ADMIN ROUTES **/

// Serve admin panel
app.use("/admin", basicAuth, express.static(path.join(__dirname, "public", "admin")));

// Get all orders (admin)
app.get("/api/admin/orders", basicAuth, (req, res) => {
  try {
    const orders = readJSON(ORDERS_FILE);
    res.json({ ok: true, orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
  }
});

// Update order status (admin)
app.put("/api/admin/orders/:id/status", basicAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  
  const allowedStatuses = ["new", "confirmed", "preparing", "ready", "picked_up", "canceled"];
  
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ ok: false, error: "Invalid status" });
  }
  
  try {
    const orders = readJSON(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === id);
    
    if (orderIndex < 0) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    
    orders[orderIndex].status = status;
    
    if (!writeJSON(ORDERS_FILE, orders)) {
      return res.status(500).json({ ok: false, error: "Failed to update order" });
    }
    
    res.json({ ok: true, order: orders[orderIndex] });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to update order status" });
  }
});

// Get settings (admin)
app.get("/api/admin/settings", basicAuth, (req, res) => {
  try {
    const settings = readJSON(SETTINGS_FILE);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

// Update settings (admin)
app.put("/api/admin/settings", basicAuth, (req, res) => {
  try {
    const existing = readJSON(SETTINGS_FILE);
    const patch = req.body || {};
    
    const merged = {
      ...existing,
      instagram_url: patch.instagram_url ?? existing.instagram_url,
      contact: { ...existing.contact, ...(patch.contact || {}) },
      status_overrides: { ...existing.status_overrides, ...(patch.status_overrides || {}) }
    };
    
    if (!writeJSON(SETTINGS_FILE, merged)) {
      return res.status(500).json({ ok: false, error: "Failed to save settings" });
    }
    
    res.json({ ok: true, settings: merged });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to update settings" });
  }
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║         MEEF MEATS SERVER RUNNING          ║
╠════════════════════════════════════════════╣
║  URL: http://localhost:${PORT.toString().padEnd(24)}║
║  Admin: http://localhost:${PORT}/admin${" ".repeat(11)}║
║  Auth: admin / ${ADMIN_PASSWORD.padEnd(24)}║
╚════════════════════════════════════════════╝
  `);
});
