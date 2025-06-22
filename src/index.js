// src/index.js
const express                  = require('express');
const crypto                   = require('crypto');
const { createClient }         = require('@supabase/supabase-js');

// ─── 1) pull in YOUR FOUR env-vars ──────────────────────────────────────────
const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHOPIFY_WEBHOOK_SECRET    = process.env.SHOPIFY_WEBHOOK_SECRET;
const PORT                      = process.env.PORT || 10000;

// sanity-check
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error(
    '❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SHOPIFY_WEBHOOK_SECRET'
  );
  process.exit(1);
}

// ─── 2) init supabase with your service-role key ─────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── 3) wire up express ─────────────────────────────────────────────────────
const app = express();

// only this route needs the raw body so we can verify Shopify’s HMAC
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // --- 3a) verify Shopify HMAC
      const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
      const bodyBuffer = req.body;
      const computedHmac = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(bodyBuffer)
        .digest('base64');

      if (computedHmac !== hmacHeader) {
        console.error('❌ HMAC mismatch', { computedHmac, hmacHeader });
        return res.status(401).send('unauthorized');
      }

      // --- 3b) parse JSON payload
      const payload = JSON.parse(bodyBuffer.toString('utf8'));
      console.log('📬 Shopify webhook:', req.get('x-shopify-topic'), payload);

      // --- 3c) only handle order-creation
      if (req.get('x-shopify-topic') === 'orders/create') {
        const email     = payload.email;
        const firstName = payload.customer?.first_name  || '';
        const lastName  = payload.customer?.last_name   || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ');

        // --- 3d) create the Supabase Auth user
        const { data: userData, error: userError } =
          await supabase.auth.admin.createUser({
            email,
            password:         Math.random().toString(36).slice(-8), // temp random
            email_confirm:    true,
            user_metadata:    { first_name: firstName, full_name }
          });

        if (userError) {
          console.error('❌ Supabase signup error', {
            status:  userError.status,
            code:    userError.code,
            message: userError.message,
            details: userError.details
          });
          return res.status(500).send('error creating user');
        }
        console.log(`🎉 Supabase user created: ${userData.user.id}`);

        // --- 3e) upsert their row into public.profiles
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            id:         userData.user.id,
            email,
            first_name: firstName,
            full_name:  fullName,
          }, { onConflict: 'id' });

        if (profileError) {
          console.error('❌ Profile upsert error', profileError);
          return res.status(500).send('error creating profile');
        }
        console.log(`✅ Profile written: ${fullName} <${email}>`);
      }

      // ack to Shopify
      res.status(200).send('OK');
    } catch (err) {
      console.error('🔥 Webhook handler error', err);
      res.status(500).send('internal error');
    }
  }
);

// everything else → 404
app.use((_req, res) => res.status(404).send('not found'));

// ─── 4) start listening ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});
