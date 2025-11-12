import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { exportOrderToSheets, updateOrderInSheets } from "./sheets-exporter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "meefadmin";
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

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
      status_overrides: {},
      notification_emails: [],
      payment_methods: {
        venmo_enabled: true,
        venmo_username: "@MeefMeats",
        zelle_enabled: true,
        zelle_info: "orders@meefmeats.com",
        cash_enabled: true,
        cash_instructions: "Bring exact change if possible",
        payment_note: "Your order is reserved but not confirmed until payment is received. Please complete payment within 24 hours."
      }
    }, null, 2),
    "utf8"
  );
}

app.use(express.json());

function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from("admin:" + ADMIN_PASSWORD).toString("base64");
  
  if (auth === expected) {
    return next();
  }
  
  res.set("WWW-Authenticate", 'Basic realm="MEEF Admin"');
  return res.status(401).send("Authentication required.");
}

function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading file:", error);
    return filePath.includes("orders") ? [] : {};
  }
}

function writeJSON(filePath, data) {
  try {
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (error) {
    console.error("Error writing file:", error);
    return false;
  }
}

async function sendAdminNotification(order) {
  if (!resend) {
    console.log("Resend not configured, skipping admin email");
    return;
  }

  const settings = readJSON(SETTINGS_FILE);
  const notificationEmails = settings.notification_emails || [];

  if (notificationEmails.length === 0) {
    console.log("No notification emails configured");
    return;
  }

  const orderDate = new Date(order.created_at);
  const pickupDate = new Date(order.pickup_date + "T00:00:00");
  
  const itemsList = order.items.map(item => {
    const price = item.size === "half" ? 3000 : 5000;
    const sizeLabel = item.size === "full" ? "Full" : "Half";
    return "  - " + item.qty + "x " + sizeLabel + " Turkey - " + item.flavor + " ($" + (price / 100).toFixed(2) + ")";
  }).join("\n");

  const emailHTML = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;"><div style="background: #000; color: #fff; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 24px;">🍖 New MEEF MEATS Order</h1></div><div style="background: #fff; padding: 30px; border-radius: 0 0 10px 10px;"><h2 style="color: #000; margin-top: 0;">Order ' + order.id + '</h2><p style="color: #666;">Placed on ' + orderDate.toLocaleDateString() + ' at ' + orderDate.toLocaleTimeString() + '</p><hr style="border: 1px solid #eee; margin: 20px 0;"><h3 style="color: #000;">Customer Information</h3><ul style="color: #333; line-height: 1.8;"><li><strong>Name:</strong> ' + order.customer_name + '</li><li><strong>Email:</strong> ' + order.email + '</li><li><strong>Phone:</strong> ' + order.phone + '</li><li><strong>Pickup Date:</strong> ' + pickupDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</li></ul><h3 style="color: #000; margin-top: 20px;">Order Details</h3><div style="background: #f9f9f9; padding: 15px; border-radius: 8px; font-family: monospace;">' + itemsList + '</div><div style="margin-top: 20px; padding: 15px; background: #000; color: #fff; border-radius: 8px; text-align: center;"><h2 style="margin: 0; font-size: 28px;">Total: $' + (order.total_cents / 100).toFixed(2) + '</h2></div><div style="margin-top: 20px; text-align: center;"><a href="https://meef-meats.onrender.com/admin" style="display: inline-block; background: #000; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">View in Admin Panel</a></div></div><div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;"><p>MEEF MEATS - Pure Texas. Pure Turkey.</p></div></div>';

  try {
    for (const email of notificationEmails) {
      await resend.emails.send({
        from: "MEEF MEATS <onboarding@resend.dev>",
        to: email,
        subject: "New Order - " + order.id + " - $" + (order.total_cents / 100).toFixed(2),
        html: emailHTML
      });
      console.log("Admin notification sent to:", email);
    }
  } catch (error) {
    console.error("Error sending admin email:", error);
  }
}

async function sendCustomerConfirmation(order) {
  if (!resend) {
    console.log("Resend not configured, skipping customer email");
    return;
  }

  const settings = readJSON(SETTINGS_FILE);
  const payment = settings.payment_methods || {};
  const orderDate = new Date(order.created_at);
  const pickupDate = new Date(order.pickup_date + "T00:00:00");
  
  const itemsList = order.items.map(item => {
    const price = item.size === "half" ? 3000 : 5000;
    const sizeLabel = item.size === "full" ? "Full" : "Half";
    return '<div style="margin: 8px 0; padding: 12px; background: #f9f9f9; border-radius: 8px;"><strong>' + item.qty + 'x ' + sizeLabel + ' Turkey</strong><br><span style="color: #666;">Flavor: ' + item.flavor + ' • $' + (price / 100).toFixed(2) + ' each</span></div>';
  }).join("");

  let paymentHTML = "";
  if (payment.venmo_enabled) {
    paymentHTML += '<div style="margin-bottom: 16px; padding: 16px; background: #f0f8ff; border-left: 4px solid #3d95ce; border-radius: 4px;"><strong style="color: #3d95ce;">💙 Venmo:</strong> Send $' + (order.total_cents / 100).toFixed(2) + ' to <strong>' + (payment.venmo_username || "@MeefMeats") + '</strong></div>';
  }
  if (payment.zelle_enabled) {
    paymentHTML += '<div style="margin-bottom: 16px; padding: 16px; background: #f5f0ff; border-left: 4px solid #6d1ed4; border-radius: 4px;"><strong style="color: #6d1ed4;">💜 Zelle:</strong> Send $' + (order.total_cents / 100).toFixed(2) + ' to <strong>' + (payment.zelle_info || "orders@meefmeats.com") + '</strong></div>';
  }
  if (payment.cash_enabled) {
    paymentHTML += '<div style="margin-bottom: 16px; padding: 16px; background: #f0fff4; border-left: 4px solid #9ae6b4; border-radius: 4px;"><strong style="color: #16a34a;">💚 Cash:</strong> Pay $' + (order.total_cents / 100).toFixed(2) + ' at pickup' + (payment.cash_instructions ? '<br><span style="font-size: 12px; color: #666;">' + payment.cash_instructions + '</span>' : '') + '</div>';
  }

  const emailHTML = '<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f5f5f5; padding: 20px;"><div style="background: #000; color: #fff; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="margin: 0; font-size: 32px;">🍖</h1><h2 style="margin: 10px 0 5px 0; font-size: 24px;">Order Confirmed!</h2><p style="margin: 0; opacity: 0.9;">Thank you for your order</p></div><div style="background: #fff; padding: 30px; border-radius: 0 0 10px 10px;"><div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;"><div style="font-size: 14px; color: #666; margin-bottom: 5px;">Order Number</div><div style="font-size: 24px; font-weight: 900; color: #000;">' + order.id + '</div></div><h3 style="color: #000; margin-top: 20px;">Your Order</h3>' + itemsList + '<div style="margin: 20px 0; padding: 20px; background: #000; color: #fff; border-radius: 8px; text-align: center;"><div style="font-size: 14px; opacity: 0.8; margin-bottom: 5px;">Total Amount</div><div style="font-size: 32px; font-weight: 900;">$' + (order.total_cents / 100).toFixed(2) + '</div></div><h3 style="color: #000; margin-top: 30px;">Pickup Details</h3><div style="background: #f9f9f9; padding: 15px; border-radius: 8px;"><p style="margin: 8px 0;"><strong>📅 Date:</strong> ' + pickupDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + '</p><p style="margin: 8px 0;"><strong>🕐 Time:</strong> 7:00 AM - 10:30 AM</p><p style="margin: 8px 0;"><strong>👤 Name:</strong> ' + order.customer_name + '</p></div><h3 style="color: #000; margin-top: 30px;">Payment Instructions</h3>' + paymentHTML + (payment.payment_note ? '<div style="background: #fff9e6; border: 1px solid #ffd966; border-radius: 8px; padding: 15px; margin-top: 15px; font-size: 13px; color: #666;"><strong style="color: #000;">⚠️ Important:</strong> ' + payment.payment_note + '</div>' : '') + '<div style="margin-top: 30px; padding: 20px; background: #f9f9f9; border-radius: 8px; text-align: center;"><p style="margin: 0 0 15px 0; color: #666;">Track your order anytime</p><a href="https://meef-meats.onrender.com/track.html?order=' + order.id + '" style="display: inline-block; background: #000; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">Track Order</a></div></div><div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;"><p style="margin: 5px 0;">MEEF MEATS</p><p style="margin: 5px 0;">Pure Texas. Pure Turkey.</p><p style="margin: 10px 0 5px 0;">Questions? Reply to this email</p></div></div>';

  try {
    await resend.emails.send({
      from: "MEEF MEATS <onboarding@resend.dev>",
      to: order.email,
      subject: "Order Confirmation - " + order.id + " - MEEF MEATS",
      html: emailHTML
    });
    console.log("Customer confirmation sent to:", order.email);
  } catch (error) {
    console.error("Error sending customer email:", error);
  }
}

function generateAllowedDates() {
  const dates = [];
  const today = new Date();
  
  // Calculate 3 weeks from today (21 days)
  const threeWeeksOut = new Date(today);
  threeWeeksOut.setDate(today.getDate() + 21);
  
  // Find what day of week 3 weeks out is
  const dayOfWeek = threeWeeksOut.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  
  // Calculate days until Friday (day 5)
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0 && dayOfWeek !== 5) daysUntilFriday = 7;
  
  // Get the Friday 3 weeks out
  const friday = new Date(threeWeeksOut);
  friday.setDate(threeWeeksOut.getDate() + daysUntilFriday);
  
  // Saturday is the next day
  const saturday = new Date(friday);
  saturday.setDate(friday.getDate() + 1);
  
  // Sunday is two days after Friday
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);
  
  // Add all three dates
  dates.push(friday.toISOString().split("T")[0]);
  dates.push(saturday.toISOString().split("T")[0]);
  dates.push(sunday.toISOString().split("T")[0]);
  
  return dates;
}

app.get("/api/allowed-dates", (req, res) => {
  try {
    const dates = generateAllowedDates();
    res.json(dates);
  } catch (error) {
    console.error("Error generating dates:", error);
    res.status(500).json({ ok: false, error: "Failed to generate dates" });
  }
});

app.get("/api/settings", (req, res) => {
  try {
    const settings = readJSON(SETTINGS_FILE);
    
    const publicSettings = {
      payment_methods: settings.payment_methods || {},
      contact: settings.contact || {},
      instagram_url: settings.instagram_url || ""
    };
    
    res.json(publicSettings);
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

app.post("/api/orders", async (req, res) => {
  const orderData = req.body || {};
  
  if (!orderData.customer_name || orderData.customer_name.length > 100) {
    return res.status(400).json({ ok: false, error: "Invalid customer name" });
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!orderData.email || !emailRegex.test(orderData.email)) {
    return res.status(400).json({ ok: false, error: "Invalid email address" });
  }
  
  if (!orderData.phone) {
    return res.status(400).json({ ok: false, error: "Phone number is required" });
  }
  
  if (!orderData.pickup_date) {
    return res.status(400).json({ ok: false, error: "Missing pickup date" });
  }
  
  if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
    return res.status(400).json({ ok: false, error: "Cart is empty" });
  }
  
  try {
    const total = orderData.items.reduce((sum, item) => {
      const price = item.size === "half" ? 3000 : 5000;
      const qty = item.qty || 1;
      return sum + (price * qty);
    }, 0);
    
    const order = {
      id: "ORD-" + Math.random().toString(36).slice(2, 8).toUpperCase(),
      created_at: new Date().toISOString(),
      status: "new",
      total_cents: total,
      customer_name: orderData.customer_name,
      email: orderData.email,
      phone: orderData.phone,
      pickup_date: orderData.pickup_date,
      items: orderData.items,
      payment_method: "",
      payment_received: false
    };
    
    const orders = readJSON(ORDERS_FILE);
    orders.push(order);
    
    const saved = writeJSON(ORDERS_FILE, orders);
    
    if (!saved) {
      console.error("Failed to save order to file");
      return res.status(500).json({ ok: false, error: "Failed to save order" });
    }
    
    console.log("Order saved successfully:", order.id);

    // Send emails (these happen after order is saved, so if they fail, order is still saved)
    try {
      await sendAdminNotification(order);
      await sendCustomerConfirmation(order);
    } catch (emailError) {
      console.error("Email sending failed, but order was saved:", emailError);
    }

    // 🔥 NEW: Export to Google Sheets
    try {
      await exportOrderToSheets(order);
    } catch (sheetsError) {
      console.error("Google Sheets export failed, but order was saved:", sheetsError);
    }
    
    res.json({ ok: true, order_id: order.id, total_cents: total });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ ok: false, error: "Failed to create order" });
  }
});

app.get("/api/track/:orderId", (req, res) => {
  const orderId = req.params.orderId;
  
  try {
    const orders = readJSON(ORDERS_FILE);
    const order = orders.find(o => o.id.toUpperCase() === orderId.toUpperCase());
    
    if (!order) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    
    res.json({ ok: true, order: order });
  } catch (error) {
    console.error("Tracking error:", error);
    res.status(500).json({ ok: false, error: "Failed to track order" });
  }
});

app.get("/admin", basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "admin.html"));
});

app.get("/admin/*", basicAuth, (req, res, next) => {
  const filePath = req.path.replace("/admin", "");
  res.sendFile(path.join(__dirname, "public", "admin", filePath));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/admin/orders", basicAuth, (req, res) => {
  try {
    const orders = readJSON(ORDERS_FILE);
    res.json({ ok: true, orders: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load orders" });
  }
});

app.put("/api/admin/orders/:id/status", basicAuth, async (req, res) => {
  const orderId = req.params.id;
  const newStatus = req.body.status;
  
  const allowedStatuses = ["new", "confirmed", "preparing", "cooking", "ready", "picked_up", "canceled"];
  
  if (!allowedStatuses.includes(newStatus)) {
    return res.status(400).json({ ok: false, error: "Invalid status" });
  }
  
  try {
    const orders = readJSON(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex < 0) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    
    orders[orderIndex].status = newStatus;
    
    if (!writeJSON(ORDERS_FILE, orders)) {
      return res.status(500).json({ ok: false, error: "Failed to update order" });
    }

    // 🔥 NEW: Update Google Sheets when status changes
    try {
      await updateOrderInSheets(orderId, { status: newStatus });
    } catch (sheetsError) {
      console.error("Google Sheets update failed:", sheetsError);
    }
    
    res.json({ ok: true, order: orders[orderIndex] });
  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).json({ ok: false, error: "Failed to update order status" });
  }
});

app.get("/api/admin/settings", basicAuth, (req, res) => {
  try {
    const settings = readJSON(SETTINGS_FILE);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ ok: false, error: "Failed to load settings" });
  }
});

app.put("/api/admin/settings", basicAuth, (req, res) => {
  try {
    const existing = readJSON(SETTINGS_FILE);
    const patch = req.body || {};
    
    const merged = {
      instagram_url: patch.instagram_url !== undefined ? patch.instagram_url : existing.instagram_url,
      contact: Object.assign({}, existing.contact, patch.contact || {}),
      status_overrides: Object.assign({}, existing.status_overrides, patch.status_overrides || {}),
      notification_emails: patch.notification_emails !== undefined ? patch.notification_emails : existing.notification_emails,
      payment_methods: Object.assign({}, existing.payment_methods, patch.payment_methods || {})
    };
    
    if (!writeJSON(SETTINGS_FILE, merged)) {
      return res.status(500).json({ ok: false, error: "Failed to save settings" });
    }
    
    res.json({ ok: true, settings: merged });
  } catch (error) {
    console.error("Settings update error:", error);
    res.status(500).json({ ok: false, error: "Failed to update settings" });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

// ✅ CRITICAL FIX #1: Add '0.0.0.0' host binding for Render
app.listen(PORT, '0.0.0.0', () => {
  console.log("MEEF MEATS running on port " + PORT);
  console.log("Resend configured:", resend ? "Yes" : "No");
  console.log("Google Sheets configured:", process.env.GOOGLE_SHEET_ID ? "Yes" : "No");
});
