// src/index.js
import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
// We need the raw body for HMAC verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

// Pull your keys from environment (never commit these)
const SHOPIFY_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SHOPIFY_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("⚠️ Missing one of SHOPIFY_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function verifyShopifyWebhook(req) {
  const hmac = req.get("X-Shopify-Hmac-Sha256") || "";
  const digest = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(req.rawBody, "utf8")
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

app.post("/webhook", async (req, res) => {
  if (!verifyShopifyWebhook(req)) {
    return res.status(401).send("❌ Invalid webhook signature");
  }

  const order = req.body;
  console.log("🚀 webhook payload:", order);

  // Build your insert object. Replace `customer.id` with whatever maps to your auth user_id.
  const profileData = {
    user_id: order.customer?.id,              // NB: must match your RLS policy on profiles.user_id
    email:    order.customer?.email,
    first_name: order.customer?.first_name,
    last_name:  order.customer?.last_name,
    name:       `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
  };

  const { data, error } = await supabase
    .from("profiles")
    .insert([ profileData ]);

  if (error) {
    console.error("❌ supabase insert error:", error);
    return res.status(500).send("Database error saving new profile");
  }

  console.log("✅ inserted profile:", data);
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🔔 Listening on http://localhost:${PORT}`);
});
