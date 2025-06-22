//// index.js
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

// ─── 1) Read & validate our env vars ────────────────────────────────────────
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_SECRET       = process.env.SHOPIFY_WEBHOOK_SECRET;
const PORT                 = process.env.PORT || 10000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SHOPIFY_SECRET) {
  console.error("❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SHOPIFY_WEBHOOK_SECRET");
  process.exit(1);
}

// ─── 2) Initialize Supabase with your service-role key ───────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── 3) Wire up Express ─────────────────────────────────────────────────────
const app = express();

// We only need raw JSON for the Shopify route (so we can verify the HMAC)
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      // 3a) Verify Shopify HMAC
      const hmacHeader = req.get("x-shopify-hmac-sha256") || "";
      const digest     = crypto
        .createHmac("sha256", SHOPIFY_SECRET)
        .update(req.body)
        .digest("base64");

      if (digest !== hmacHeader) {
        console.error("❌ HMAC mismatch", { digest, hmacHeader });
        return res.status(401).send("unauthorized");
      }

      // 3b) Parse the JSON payload
      const event = JSON.parse(req.body.toString("utf8"));
      console.log("📬 Shopify webhook:", req.get("x-shopify-topic"), event);

      // 3c) Handle only order-created events
      if (req.get("x-shopify-topic") === "orders/create") {
        const email    = event.email;
        const fullName = (
          (event.customer?.first_name || "") +
          " " +
          (event.customer?.last_name  || "")
        ).trim();

        // 3d) Create a Supabase user via the Admin API
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: Math.random().toString(36).slice(-8), // random temp password
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (error) {
          console.error("❌ Supabase signup error", error);
          return res.status(500).send("error creating user");
        }

        console.log(`🎉 Supabase user created: ${data.user.id}`);
      }

      // 3e) Acknowledge receipt
      res.status(200).send("OK");
    } catch (err) {
      console.error("🔥 Webhook handler error", err);
      res.status(500).send("internal error");
    }
  }
);

// Fallback for any other route
app.use((req, res) => res.status(404).send("not found"));

// ─── 4) Start the server ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});

