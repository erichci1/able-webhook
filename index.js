// index.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// 1️⃣ Pull in env vars
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_SECRET        = process.env.SHOPIFY_WEBHOOK_SECRET;

// 2️⃣ Create an “admin” Supabase client
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const app = express();

// 3️⃣ We need the raw body to verify the HMAC
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // @ts-ignore
      req.rawBody = buf;
    },
  })
);

app.post("/webhook", async (req, res) => {
  // ——— Validate Shopify HMAC ———
  const hmac = req.get("x-shopify-hmac-sha256") || "";
  const digest = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(req.rawBody)
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(digest))) {
    console.error("❌ HMAC mismatch", { hmac, digest });
    return res.status(401).send("HMAC mismatch");
  }

  console.log("✅ Shopify webhook verified");

  // ——— Extract customer info ———
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

  console.log("📬 New order:", order.id, { email, fullName });

  // ——— Create Supabase Auth User ———
  try {
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      user_metadata: { full_name: fullName },
      email_confirm: true,
      password: crypto.randomBytes(16).toString("hex"),
    });

    if (error) throw error;

    console.log("🎉 Supabase user created:", user.id);
    return res.status(200).send("User created");
  } catch (err) {
    console.error("❌ Error creating Supabase user", err);
    return res.status(500).send("Error creating user");
  }
});

// 4️⃣ Start listening
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Listening on port ${port}`);
});
