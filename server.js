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
app.use(express.static(path.join(__dirname, "public")));

function basicAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from("admin:" + ADMIN_PASSWORD).toString("base64");
  if (auth === expected) return next();
  res.set("WWW-Authent
