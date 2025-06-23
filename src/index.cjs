// src/index.cjs
const express      = require('express');
const { createClient } = require('@supabase/supabase-js');
const crypto       = require('crypto');

// 1) pull in your env-vars
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,           // <-- use the anon key here
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error('❌ Missing one of SUPABASE_URL, SUPABASE_ANON_KEY or SHOPIFY_WEBHOOK_SECRET');
  process.exit(1);
}

// 2) init Supabase with the anon key
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3) set up Express
const app = express();

// only raw JSON for Shopify
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // a) verify HMAC
      const hmacHeader = req.get('x-shopify-hmac-sha256') || '';
      const digest     = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64');

      if (digest !== hmacHeader) {
        console.error('❌ HMAC mismatch', { digest, hmacHeader });
        return res.status(401).send('unauthorized');
      }

      // b) parse payload
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify webhook orders/create', event);

      // c) only on order creation
      if (req.get('x-shopify-topic') === 'orders/create') {
        const email     = event.email;
        const firstName = event.customer?.first_name || '';
        const lastName  = event.customer?.last_name  || '';
        const fullName  = [firstName, lastName].filter(Boolean).join(' ');

        // d) try signing them up
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email,
          password: Math.random().toString(36).slice(-8),
          options: {
            emailRedirectTo: `${process.env.FRONTEND_URL}/welcome`,
            data: { full_name: fullName, first_name: firstName }
          }
        });

        if (signUpErr && signUpErr.status !== 400 /* 400 = email_exists */) {
          console.error('❌ Sign-up error', signUpErr);
          return res.status(500).send('error signing up');
        }
        // (if status===400/email_exists, we’ll just insert the profile below)

        // e) upsert profile row
        const { error: dbErr } = await supabase
          .from('profiles')
          .upsert({
            id         : signUpData?.user?.id,   // or lookup existing user ID via admin API if needed
            full_name  : fullName,
            first_name : firstName,
            email
          }, { onConflict: 'id' });

        if (dbErr) {
          console.error('❌ Profile upsert error', dbErr);
          return res.status(500).send('error writing profile');
        }

        console.log(`🎉 Done for ${email}`);
      }

      res.status(200).send('OK');
    } catch (err) {
      console.error('🔥 Webhook handler error', err);
      res.status(500).send('internal error');
    }
  }
);

// 4) fallback & start
app.use((_, res) => res.status(404).send('not found'));
app.listen(PORT, () => {
  console.log(`🚀 Webhook listener running on port ${PORT}`);
});
