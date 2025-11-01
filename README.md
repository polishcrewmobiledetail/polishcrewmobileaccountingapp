# Polish Crew — Mobile CRM & Booking PWA

This repository powers the offline-first Polish Crew Progressive Web App. The latest release extends the original accounting utilities with a full CRM pipeline, Supabase synchronisation, Stripe-ready deposits, and a public self-service booking experience.

## Highlights

* **Supabase backend** – real-time sync for customers, quotes, jobs, appointments, and transactions. Offline changes queue locally until connectivity returns.
* **Kanban CRM** – the in-app CRM tab visualises New → Quoted → Booked → In Progress → Paid → Complete stages and gives quick access to notes, checklists, timers, and payments.
* **Public booking flow** – `/book` delivers a mobile-first form for clients to request service, optionally collect a deposit, and stream the lead directly into Supabase.
* **Technician friendly** – local caching, printable summaries, JSON/CSV export, and the original quote builder remain intact.

## Configuration

Both `index.html` and `book/index.html` ship with an inline `<script id="pc-config">` block. During deployment replace the placeholder values with your Supabase project settings:

```html
<script id="pc-config" type="application/json">
{
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseAnonKey": "YOUR_PUBLIC_ANON_KEY",
  "stripePriceId": "price_123",          // optional
  "stripeFunction": "create-stripe-checkout",
  "notificationsFunction": "send-booking-confirmation",
  "depositAmount": 50
}
</script>
```

If you need to keep secrets out of the repository, inject the same JSON via a server-side include or a build step prior to publishing.

### Supabase schema

The `supabase/` folder contains:

* `schema.sql` – ready-to-run SQL defining tables, relationships, and RLS policies aligned with the in-app data model.
* `sample-data.json` – example payloads for quickly seeding a development project.

Apply the schema in the Supabase SQL editor, then import the sample data through the Table Editor or `supabase db remote commit`.

### Stripe deposits & webhooks

When `stripePriceId` is present, the booking form will request a checkout session through the configured Supabase Edge Function (`stripeFunction`). Use the notifications function to deliver confirmation emails/SMS (Resend, Twilio, etc.).

## Development & Deployment

1. Install dependencies (none required – vanilla HTML/JS).
2. Adjust `pc-config` values locally.
3. Serve the project with any static HTTP server for testing (`npx serve .`).
4. Deploy to GitHub Pages, Cloudflare Pages, or similar static hosting. The service worker caches `/index.html`, `/book/index.html`, and critical assets for offline use.

The app registers `pcwa-v3.0.0` as the cache label. Bump the version in `service-worker.js` and the drawer footer when shipping new assets to trigger an automatic refresh.

## Legacy utilities

* Custom package builder with lockable add-ons and pricing guidance.
* Menu editor, quote builder, timers, printable receipts, JSON/CSV export.
* No-service-worker build available at `index_nosw.html` for troubleshooting.
