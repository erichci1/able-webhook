// src/index.cjs

const express = require('express');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1️⃣ Env
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error('❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY or SHOPIFY_WEBHOOK_SECRET');
  process.exit(1);
}

// two clients: one as admin (for table inserts), one as anon (for OTP)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();

app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // ─── Verify Shopify HMAC ───────────────────────────
      const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64');
      if (digest !== hmacHeader) {
        console.error('❌ HMAC mismatch', { digest, hmacHeader });
        return res.status(401).send('unauthorized');
      }

      // ─── Parse & guard ─────────────────────────────────
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify payload', event);
      if (req.get('x-shopify-topic') !== 'orders/create') {
        return res.status(200).send('ignored');
      }

      // ─── Extract user info ─────────────────────────────
      const cust      = event.customer || {};
      const firstName = cust.first_name || '';
      const lastName  = cust.last_name  || '';
      const fullName  = [firstName, lastName].filter(Boolean).join(' ');
      const email     = event.email || '';

      // ─── Send magic link (this auto-creates the user) ──
      const { error: otpError } = await supabaseAnon.auth.signInWithOtp({ email });
      if (otpError) {
        console.error('❌ OTP send failed:', otpError);
        return res.status(500).send('error sending magic link');
      }
      console.log('✉️ Magic link sent to', email);

      // ─── Insert profile row (service-role) ────────────
      const { error: dbError } = await supabaseAdmin
        .from('profiles')
        .upsert(
          {
            id:         email,       // or use email as PK, or fetch user.id later
            first_name: firstName,
            full_name:  fullName,
            email
          },
          { onConflict: 'id' }
        );
      if (dbError) {
        console.error('❌ Profile upsert failed:', dbError);
        return res.status(500).send('error writing profile');
      }
      console.log(`✅ Profile upserted for ${email}`);

      return res.status(200).send('OK');

    } catch (err) {
      console.error('🔥 Handler error', err);
      return res.status(500).send('internal error');
    }
  }
);

// 404 & start
app.use((_req, res) => res.status(404).send('not found'));
app.listen(PORT, () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
