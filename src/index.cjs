// supabase/functions/shopify-webhook/index.ts

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@^2";
import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

// 1️⃣ Pull in your secrets
const SUPABASE_URL              = Deno.env.get("DB_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const SHOPIFY_WEBHOOK_SECRET    = Deno.env.get("SHOPIFY_WEBHOOK_SECRET")!;

// 2️⃣ Init Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  // Only POST /shopify-webhook
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/shopify-webhook") {
    return new Response("Not found", { status: 404 });
  }

  // a) Verify Shopify HMAC
  const body = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") || "";
  const digest = createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(body)
    .digest("base64");
  if (digest !== hmacHeader) {
    console.error("❌ HMAC mismatch", { digest, hmacHeader });
    return new Response("unauthorized", { status: 401 });
  }

  // b) Parse and filter for orders/create
  const topic = req.headers.get("x-shopify-topic");
  const event = JSON.parse(body);
  console.log("📬 Shopify payload", event);
  if (topic !== "orders/create") {
    return new Response("ignored", { status: 200 });
  }

  // c) Compute name & email with fallbacks
  const cust     = event.customer        || {};
  const billing  = event.billing_address || {};
  const firstName = cust.first_name || billing.first_name || "";
  const lastName  = cust.last_name  || billing.last_name  || "";
  const fullName  = [firstName, lastName].filter(Boolean).join(" ");
  const email     = event.email || "";

  // d) Create Supabase Auth user
  const { data: user, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password:      Math.random().toString(36).slice(-8),
    email_confirm: true,
    raw_user_meta_data: { first_name: firstName, full_name: fullName },
  });
  if (authErr) {
    console.error("❌ admin.createUser error", authErr);
    return new Response("error creating user", { status: 500 });
  }
  console.log("🎉 Created user", user.id);

  // e) Upsert profile row
  const { error: dbErr } = await supabase
    .from("profiles")
    .upsert({ id: user.id, first_name: firstName, full_name: fullName, email });
  if (dbErr) {
    console.error("❌ profiles upsert error", dbErr);
    return new Response("error writing profile", { status: 500 });
  }
  console.log("✅ Profile upserted", user.id);

  return new Response("OK", { status: 200 });
});
