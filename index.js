import express from "express"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

dotenv.config()

const app = express()
// Shopify needs the raw body to verify HMAC
app.use(express.raw({ type: "application/json" }))

// Grab the port Render will assign us
const PORT = process.env.PORT || 3000

// Health check so we can verify the server is up
app.get("/", (req, res) => {
  res.send("🟢 A.B.L.E. webhook server is alive!")
})

// Your webhook handler:
app.post("/webhook/orders/paid", async (req, res) => {
  // …your HMAC check & Supabase upsert logic…
})

// Start listening
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`)
})
