import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

///////////////////////////////////////////////////////////////////////////////
// 1) Load your credentials from environment variables
///////////////////////////////////////////////////////////////////////////////
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing one of SUPABASE_URL or SUPABASE_KEY in env");
  process.exit(1);
}

///////////////////////////////////////////////////////////////////////////////
// 2) Initialize Supabase client
///////////////////////////////////////////////////////////////////////////////
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

///////////////////////////////////////////////////////////////////////////////
// 3) Build Express webhook endpoint
///////////////////////////////////////////////////////////////////////////////
const app = express();
app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
  console.log("📦 Got webhook!", {
    topic: req.headers["x-shopify-topic"],
    shop: req.headers["x-shopify-shop-domain"],
  });

  // TODO: verify HMAC, then process payload...
  // Example: insert the order (or customer) into Supabase
  // const { data, error } = await supabase
  //   .from("orders")
  //   .insert([{ /* map fields from req.body */ }]);

  res.status(200).send("OK");
});

///////////////////////////////////////////////////////////////////////////////
// 4) Start server
///////////////////////////////////////////////////////////////////////////////
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server listening on port ${PORT}`);
});
