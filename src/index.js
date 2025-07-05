// src/index.cjs (or .js)
import express from "express"
import { createClient } from "@supabase/supabase-js"

const app = express()
app.use(express.json())

const SUPABASE_URL = "https://srkuufwbwqipohhcmqmu.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNya3V1Zndid3FpcG9oaGNtcW11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMxMTA1MDYsImV4cCI6MjA1ODY4NjUwNn0.XuN_eG8tEl1LQp84XK1HwwksWsyc41L_xeqbxh-fM-8"   // ⚠️ use service_role for admin inserts
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

app.post("/webhook", async (req, res) => {
  console.log("🚀 webhook payload:", req.body)

  try {
    const { data, error } = await supabase
      .from("profiles")
      .insert({
        id: req.body.user_id,       // or however you’re generating/pulling id
        email: req.body.email,
        name: req.body.name,
      })
      .select() // you can add `.single()` if you expect exactly one row back

    if (error) {
      // 🔥 Print *every* property on the error object
      console.error("⛔ supabase insert error:\n", {
        message: error.message,
        code:    error.code,
        details: error.details,
        hint:    error.hint,
      })
      return res.status(500).send("DB error saving new user")
    }

    console.log("✅ insert succeeded:", data)
    res.send("OK")
  } catch (err) {
    console.error("❌ unexpected exception:", err)
    res.status(500).send("Unexpected error")
  }
})

app.listen(3000, () => console.log("🚨 Listening on http://localhost:3000"))
