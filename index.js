// index.js
import express from "express";

const app = express();

// JSON body parsing (needed if Shopify sends JSON)
app.use(express.json());

// A simple GET so we know the server is live
app.get("/", (_req, res) => {
  res.send("👍 Webhook service is live");
});

// A minimal POST handler at /webhook
app.post("/webhook", (req, res) => {
  console.log("📬 Got webhook!");
  console.log("Headers:", req.headers);
  console.log("Body:", JSON.stringify(req.body).slice(0, 2000));
  // For now, just acknowledge receipt
  res.status(200).json({ received: true });
});

// Bind to the PORT Render provides (or default 3000 locally)
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`➡️  Listening on port ${port}`);
});
