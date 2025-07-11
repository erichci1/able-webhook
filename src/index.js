// src/index.js
import express from "express";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

const SHOPIFY_SECRET            = process.env.SHOPIFY_WEBHOOK_SECRET;
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SHOPIFY_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "⚠️ Missing one of SHOPIFY_WEBHOOK_SECRET, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function verifyShopifyWebhook(req) {
  const hmac   = req.get("X-Shopify-Hmac-Sha256") || "";
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

  // Build a row matching your 'profiles' columns exactly:
  const profile = {
    user_id:             order.customer?.id.toString(),  // uuid PK from auth.users
    email:               order.customer?.email            || null,
    first_name:          order.customer?.first_name       || null,
    last_name:           order.customer?.last_name        || null,
    name:                `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || null,
    shopify_customer_id: order.customer?.id.toString()    || null,
    // focus, onboarding_complete, assessment_taken will default per your schema
    // updated_at & created_at are handled by the DB defaults
  };

  const { error } = await supabase
    .from("profiles")
    .upsert(profile, { returning: "minimal" });

  if (error) {
    console.error("❌ supabase upsert error:", error);
    return res.status(500).send("Database error saving profile");
  }

  console.log("✅ profile upserted");
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔔 Listening on :${PORT}`));
