// index.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// 1) Pull in your env vars
const SUPABASE_URL            = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SHOPIFY_WEBHOOK_SECRET  = process.env.SHOPIFY_WEBHOOK_SECRET!;

// 2) Create a Supabase "admin" client
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

const app = express();

// 3) We need the raw body to verify the HMAC
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // @ts-ignore
      req.rawBody = buf;
    },
  })
);

// 4) Webhook endpoint
app.post("/webhook", async (req, res) => {
  // --- Validate Shopify HMAC ---
  const hmacHeader = req.get("x-shopify-hmac-sha256")!;
  const computedHmac = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computedHmac))) {
    console.error("❌ HMAC mismatch");
    return res.status(401).send("HMAC mismatch");
  }

  // --- Parse the order payload ---
  const order = req.body;
  const email =
    order.email ||
    order.customer?.email ||
    order.customer?.default_address?.email;
  const fullName =
    order.shipping_address?.name ||
    [order.customer?.first_name, order.customer?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "";

  console.log("📬 Got valid webhook for order:", order.id);
  console.log("    → email:", email);
  console.log("    → name: ", fullName);

  // --- Create a new Supabase Auth User ---
  // This writes to `auth.users`.  The on_auth_user_created trigger
  // will then fan-out into your `public.profiles` table automatically.
  const { data: newUser, error: userError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      user_metadata: { full_name: fullName },
      email_confirm: true,       // auto-confirm so they can log in
      password: crypto.randomBytes(16).toString("hex"), // random placeholder
    });

  if (userError) {
    console.error("❌ Error creating Supabase user:", userError);
    return res.status(500).send("Error creating user");
  }

  console.log("✅ Supabase auth user created:", newUser.id);

  // You could also send them an email here with a "magic link" or
  // a reset-password link, using the Supabase admin API.

  res.status(200).send("ok");
});

// 5) Start up
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});
