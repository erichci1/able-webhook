// src/index.js
import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

// we need the raw body for HMAC verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

// pull secrets from your .env
const SHOPIFY_SECRET             = process.env.SHOPIFY_WEBHOOK_SECRET;
const SUPABASE_URL               = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SHOPIFY_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "⚠️ Missing one of SHOPIFY_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || "";
  const computed = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(req.rawBody, "utf8")
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
}

app.post("/webhook", async (req, res) => {
  // 1) verify signature
  if (!verifyShopifyWebhook(req)) {
    return res.status(401).send("❌ Invalid webhook signature");
  }

  const order = req.body;
  console.log("🚀 webhook payload:", order);

  // 2) prepare your row – note we now write shopify_customer_id, not user_id
  const profileRow = {
    shopify_customer_id: order.customer?.id?.toString()      || null,
    email:               order.customer?.email              || null,
    first_name:          order.customer?.first_name         || null,
    last_name:           order.customer?.last_name          || null,
    name: [
      order.customer?.first_name,
      order.customer?.last_name
    ]
      .filter(Boolean)
      .join(" "),
    // you can add more fields here if needed
  };

  // 3) insert into your existing `profiles` table
  const { data, error } = await supabase
    .from("profiles")
    .insert([ profileRow ]);

  if (error) {
    console.error("❌ supabase insert error:", error);
    return res.status(500).send("Database error saving new profile");
  }

  console.log("✅ inserted profile:", data);
  return res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔔 Listening on http://localhost:${PORT}`));
