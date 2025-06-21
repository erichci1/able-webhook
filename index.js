// index.js
import express from "express"
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"

// ── Env vars ──────────────────────────────────────────────────────────────────
const {
  SUPA_URL,
  SUPA_SERVICE_ROLE_KEY,
  SHOPIFY_SECRET,
  FRAMER_REDIRECT,
  PORT = 3000,
} = process.env

// ── Supabase admin client ─────────────────────────────────────────────────────
const supabase = createClient(SUPA_URL, SUPA_SERVICE_ROLE_KEY)

// ── Express setup ─────────────────────────────────────────────────────────────
const app = express()

// We need the raw body to verify Shopify's HMAC
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
)

app.post("/webhook", async (req, res) => {
  try {
    // 1) Verify Shopify HMAC
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256") || ""
    const computedHmac = crypto
      .createHmac("sha256", SHOPIFY_SECRET)
      .update(req.body, "utf8")
      .digest("base64")

    if (computedHmac !== hmacHeader) {
      console.warn("⚠️ Shopify HMAC mismatch")
      return res.status(401).send("HMAC validation failed")
    }

    // 2) Parse the order payload
    const order = JSON.parse(req.body.toString("utf8"))
    const email = order.email || order.customer?.email
    if (!email) {
      return res.status(200).send("No customer email—ignoring")
    }

    // 3) (Optional) Check that this order contains *your* product(s)
    const SHOPIFY_PRODUCT_IDS = [12345678] // ← replace with your real product ID(s)
    const orderedIds = order.line_items.map((li) => li.product_id)
    if (!orderedIds.some((id) => SHOPIFY_PRODUCT_IDS.includes(id))) {
      return res.status(200).send("Not your program—ignoring")
    }

    // 4) Create the user in Supabase Auth (service role)
    const { data: user, error: createErr } =
      await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: order.customer?.first_name || null },
      })

    if (createErr) {
      console.error("❌ createUser error:", createErr)
      // If they already exist, you might skip or handle differently
      // return res.status(500).send("Error creating user")
    }

    // 5) Send a magic link to finish signup
    //    This uses your Supabase SMTP/email settings to dispatch the link
    const { error: linkErr } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: FRAMER_REDIRECT },
    })

    if (linkErr) {
      console.error("❌ signInWithOtp error:", linkErr)
      return res.status(500).send("Error sending magic link")
    }

    console.log(`✅ Invited ${email} successfully`)
    return res.status(200).send("OK")
  } catch (err) {
    console.error("🔥 Unexpected error in /webhook:", err)
    return res.status(500).send("Internal Server Error")
  }
})

app.listen(PORT, () => {
  console.log(`🚀 Webhook listener up on port ${PORT}`)
})
