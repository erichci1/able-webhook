// src/index.cjs

const express = require('express');
const crypto  = require('crypto');
const fetch   = require('node-fetch');

// 1️⃣ Env
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

const app = express();

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      //─── Verify HMAC ────────────────────────────────────
      const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64');
      if (digest !== hmacHeader) {
        console.error('❌ HMAC mismatch', { digest, hmacHeader });
        return res.status(401).send('unauthorized');
      }

      //─── Parse & guard payload ──────────────────────────
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify payload', event);
      if (req.get('x-shopify-topic') !== 'orders/create') {
        return res.status(200).send('ignored');
      }
      const cust      = event.customer || {};
      const firstName = String(cust.first_name || '');
      const lastName  = String(cust.last_name  || '');
      const fullName  = [firstName, lastName].filter(Boolean).join(' ');
      const email     = String(event.email || '');

      //─── Create the Auth user via Admin API ────────────
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
            first_name: firstName,
            full_name:  fullName
          }
        })
      });
      const userData = await createRes.json();
      if (!createRes.ok) {
        console.error('❌ Admin createUser failed:', userData);
        return res.status(500).send('error creating user');
      }
      console.log('🎉 Created auth user:', userData.id);

      //─── Manually insert into profiles (only if you choose to) ──
      //    (Skip this if you rely on your DB trigger instead)
      /*
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
        const err = await insertRes.text();
        console.error('❌ profiles insert failed:', err);
        return res.status(500).send('error writing profile');
      }
      console.log(`✅ Profile created for ${userData.id}`);
      */

      return res.status(200).send('OK');
    } catch (err) {
      console.error('🔥 Handler error', err);
      return res.status(500).send('internal error');
    }
  }
);

app.use((_req, res) => res.status(404).send('not found'));
app.listen(PORT, () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
