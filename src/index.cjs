// src/index.cjs

const express = require('express');
const crypto  = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// 1️⃣ Pull in env vars
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env;

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !SUPABASE_ANON_KEY ||
  !SHOPIFY_WEBHOOK_SECRET
) {
  console.error(
    '❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY or SHOPIFY_WEBHOOK_SECRET'
  );
  process.exit(1);
}

// 2️⃣ Init two Supabase clients
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const supabaseAnon  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 3️⃣ Wire up Express
const app = express();

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

      // b) Parse the payload
      const event = JSON.parse(req.body.toString('utf8'));
      console.log('📬 Shopify payload', event);
      if (req.get('x-shopify-topic') !== 'orders/create') {
        return res.status(200).send('ignored');
      }

      // c) Extract user info
      const cust      = event.customer || {};
      const firstName = String(cust.first_name || '');
      const lastName  = String(cust.last_name  || '');
      const fullName  = [firstName, lastName].filter(Boolean).join(' ');
      const email     = String(event.email || '');

      // d) Send magic link (this auto-creates the user)
      const { error: otpError } = await supabaseAnon.auth.signInWithOtp({
        email
      });
      if (otpError) {
        console.error('❌ OTP send failed:', otpError);
        return res.status(500).send('error sending magic link');
      }
      console.log('✉️ Magic link sent to', email);

      // e) Upsert the profile row yourself
      const { error: dbError } = await supabaseAdmin
        .from('profiles')
        .upsert(
          {
            id:         email,
            first_name: firstName,
            full_name:  fullName,
            email
          },
          { onConflict: 'id' }
        );
      if (dbError) {
        console.e
