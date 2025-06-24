// src/index.cjs
const express       = require('express');
const crypto        = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// env
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error('❌ Missing env vars'); process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const app      = express();

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // 1) Verify HMAC…
    const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
    const digest = crypto.createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('base64');
    if (digest !== hmacHeader) return res.status(401).send('unauthorized');

    // 2) Parse & bail if not orders/create
    const event = JSON.parse(req.body.toString('utf8'));
    if (req.get('x-shopify-topic') !== 'orders/create') {
      return res.status(200).send('ignored');
    }

    // 3) Extract name + email
    const cust      = event.customer || {};
    const firstName = cust.first_name || '';
    const lastName  = cust.last_name  || '';
    const fullName  = [firstName, lastName].filter(Boolean).join(' ');
    const email     = event.email;

    // 4) Create Supabase user with metadata only
    const { data:user, error } = await supabase.auth.admin.createUser({
      email,
      password      : Math.random().toString(36).slice(-8),
      email_confirm : true,
      raw_user_meta_data: {
        first_name: firstName,
        full_name:  fullName
      }
    });
    if (error) {
      console.error('❌ admin.createUser error', error);
      return res.status(500).send('error creating user');
    }
    console.log('🎉 Created auth user:', user.id);
    return res.status(200).send('OK');
  }
);

app.listen(PORT, () => console.log(`🚀 Listening on ${PORT}`));
