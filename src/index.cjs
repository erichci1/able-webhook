// src/index.cjs

const express = require('express');
const crypto  = require('crypto');
const fetch   = require('node-fetch'); // npm install node-fetch@2

// 1️⃣ Pull in env vars
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error('❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SHOPIFY_WEBHOOK_SECRET');
  process.exit(1);
}

const app = express();

// Only raw JSON for Shopify (so we can verify the HMAC)
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // a) Verify Shopify HMAC
      const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64');

      if (digest !== hmacHeader) {
        console.error('❌ HMAC mismatch', { digest, hmacHeader });
        return res.status(401).send('unauthorized');
      }

      // b) Parse JSON payload
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify webhook payload', event);

      // c) Only handle order-create events
      if (req.get('x-shopify-topic') !== 'orders/create') {
        return res.status(200).send('ignored');
      }

      // d) Extract user info with safe defaults
      const customer  = event.customer || {};
      const firstName = customer.first_name || '';
      const lastName  = customer.last_name  || '';
      const fullName  = [firstName, lastName].filter(Boolean).join(' ');
      const email     = event.email;

      // e) Create Supabase Auth user via Admin API
      const adminUrl = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`;
      const password = Math.random().toString(36).slice(-8);
      const createRes = await fetch(adminUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          raw_user_meta_data: {
            full_name: fullName,
            first_name: firstName
          }
        })
      });

      const userData = await createRes.json();
      if (!createRes.ok) {
        console.error('❌ Admin createUser failed:', userData);
        return res.status(500).send('error creating user');
      }
      console.log('🎉 Created auth user:', userData.id);

      // f) Insert into profiles table via REST
      const profilesUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/profiles`;
      const insertRes = await fetch(profilesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey:        SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer:        'return=minimal'
        },
        body: JSON.stringify({
          id:         userData.id,
          first_name: firstName,
          full_name:  fullName,
          email
        })
      });

      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error('❌ Profile insert failed:', errText);
        return res.status(500).send('error writing profile');
      }
      console.log(`✅ Profile created for ${userData.id}`);

      return res.status(200).send('OK');
    } catch (err) {
      console.error('🔥 Webhook handler error', err);
      return res.status(500).send('internal error');
    }
  }
);

// 4️⃣ Fallback & start server
app.use((_req, res) => res.status(404).send('not found'));
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});
