// src/index.cjs
const express             = require('express')
const { createClient }    = require('@supabase/supabase-js')
const crypto              = require('crypto')

// 1️⃣ pull in your env-vars
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SHOPIFY_WEBHOOK_SECRET,
  PORT = 10000
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
  console.error(
    '❌ Missing one of SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SHOPIFY_WEBHOOK_SECRET'
  )
  process.exit(1)
}

// 2️⃣ initialize Supabase with your service-role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// 3️⃣ set up Express
const app = express()

// only raw JSON for Shopify so we can verify HMAC
app.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      // a) verify Shopify HMAC
      const hmacHeader = req.get('x-shopify-hmac-sha256') || ''
      const digest = crypto
        .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
        .update(req.body)
        .digest('base64')

      if (digest !== hmacHeader) {
        console.error('❌ HMAC mismatch', { digest, hmacHeader })
        return res.status(401).send('unauthorized')
      }

      // b) parse the JSON payload
      const event = JSON.parse(req.body.toString('utf8'))
      console.log('📬 Shopify webhook orders/create', event)

      // c) only on order creation
      if (req.get('x-shopify-topic') === 'orders/create') {
        const email     = event.email
        const firstName = event.customer?.first_name || ''
        const lastName  = event.customer?.last_name  || ''
        const fullName  = `${firstName} ${lastName}`.trim()

        // d) create Supabase Auth user
        const { data: user, error: authError } =
          await supabase.auth.admin.createUser({
            email,
            password: Math.random().toString(36).slice(-8),
            email_confirm: true,
            user_metadata: { full_name: fullName, first_name: firstName }
          })

        if (authError) {
          console.error('❌ Supabase signup error', {
            message: authError.message,
            code:    authError.code,
            details: authError.details,
            hint:    authError.hint
          })
          return res.status(500).send('error creating user')
        }

        // e) write to your profiles table
        const { error: dbError } = await supabase
          .from('profiles')
          .insert([
            {
              id:         user.id,       // ↪ use the same UUID
              full_name:  fullName,      // ↪ snake_case column
              first_name: firstName,     // ↪ snake_case column
              email                      // ↪ shorthand for email: email
            }
          ])

        if (dbError) {
          console.error('❌ Supabase profiles insert error', dbError)
          return res.status(500).send('error writing profile')
        }

        console.log(`🎉 Created user+profile: ${user.id}`)
      }

      // ack back to Shopify
      res.status(200).send('OK')
    } catch (err) {
      console.error('🔥 Webhook handler error', err)
      res.status(500).send('internal error')
    }
  }
)

// fallback + start
app.use((req, res) => res.status(404).send('not found'))
app.listen(PORT, () =>
  console.log(`🚀 Webhook listener running on port ${PORT}`)
)
