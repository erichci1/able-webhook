// src/index.js
const express        = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto         = require("crypto");

// ─── 1) Read & validate env vars ───────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_SECRET       = process.env.SHOPIFY_WEBHOOK_SECRET;
const PORT                 = Number(process.env.PORT) || 10000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_SECRET) {
  console.error(
    "❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SHOPIFY_WEBHOOK_SECRET"
  );
  process.exit(1);
}

// ─── 2) Initialize Supabase with the service-role key ───────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── 3) Configure Express ──────────────────────────────────────────────────
const app = express();

// Only raw JSON on the webhook route for HMAC verification
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // 3a) Verify Shopify HMAC
      const hmacHeader = req.get("x-shopify-hmac-sha256") || "";
      const digest = crypto
        .createHmac("sha256", SHOPIFY_SECRET)
        .update(req.body)
        .digest("base64");

      if (digest !== hmacHeader) {
        console.error("❌ HMAC mismatch", { digest, hmacHeader });
        return res.status(401).send("Unauthorized");
      }

      // 3b) Parse the payload
      const event = JSON.parse(req.body.toString("utf8"));
      console.log("📬 Shopify webhook:", req.get("x-shopify-topic"), event);

      // 3c) Only handle order creation
      if (req.get("x-shopify-topic") === "orders/create") {
        const email = event.email;
        const fullName = [
          event.customer?.first_name,
          event.customer?.last_name,
        ]
          .filter(Boolean)
          .join(" ");

        // 3d) Create a Supabase user via Admin API
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: Math.random().toString(36).slice(-8),
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (error) {
          console.error("❌ Supabase signup error", error);
          return res.status(500).send("Error creating user");
        }

        console.log(`🎉 Supabase user created: ${data.user.id}`);
      }

      // 3e) Ack
      res.status(200).send("OK");
    } catch (err) {
      console.error("🔥 Webhook handler error", err);
      res.status(500).send("Internal error");
    }
  }
);

// Fallback for everything else
app.use((req, res) => res.status(404).send("Not found"));

// ─── 4) Start listening ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});
