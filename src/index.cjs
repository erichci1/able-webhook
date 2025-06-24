// src/index.cjs
const express = require('express');
const crypto  = require('crypto');
const fetch   = require('node-fetch'); // ensure installed via npm install node-fetch@2

// 1) Env
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

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // a) Verify Shopify HMAC
      const hmac = req.get('x-shopify-hmac-sha256') || '';
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64');
      if (digest !== hmac) return res.status(401).send('unauthorized');

      // b) Parse payload & bail
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify payload', event);
      if (req.get('x-shopify-topic') !== 'orders/create') {
        return res.status(200).send('ignored');
      }

      // c) Compute names + email
      const cust    = event.customer        || {};
      const bill   = event.billing_address || {};
      const firstName = cust.first_name || bill.first_name || '';
      const lastName  = cust.last_name  || bill.last_name  || '';
      const fullName  = [firstName, lastName].filter(Boolean).join(' ');
      const email     = event.email || '';

      // d) Create user
      const adminUrl = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`;
      const password = Math.random().toString(36).slice(-8);
      const createRes = await fetch(adminUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          apikey:           SUPABASE_SERVICE_ROLE_KEY,
          Authorization:    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          raw_user_meta_data: { first_name: firstName, full_name: fullName }
        })
      });
      const userData = await createRes.json();
      if (!createRes.ok) {
        console.error('❌ admin.createUser error', userData);
        return res.status(500).send('error creating user');
      }
      console.log('🎉 Created auth user:', userData.id);

      // e) Upsert profile
      const profilesUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/profiles`;
      const insertRes = await fetch(profilesUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          apikey:           SUPABASE_SERVICE_ROLE_KEY,
          Authorization:    `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer:           'resolution=merge-duplicates'
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
        console.error('❌ profiles upsert error', errText);
        return res.status(500).send('error writing profile');
      }
      console.log(`✅ Profile upserted for ${userData.id}`);

      res.status(200).send('OK');
    } catch (err) {
      console.error('🔥 Handler error', err);
      res.status(500).send('internal error');
    }
  }
);

app.use((_req, res) => res.status(404).send('not found'));
app.listen(PORT, () => console.log(`🚀 Listening on port ${PORT}`));
