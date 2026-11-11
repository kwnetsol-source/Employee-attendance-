# Employee Attendance Frontend (Starter)

## Files
- `index.html` — page layout
- `style.css` — dark / royal-gold responsive UI
- `config.js` — Supabase project URL and publishable key
- `app.js` — login, employee attendance, GPS upload, manager pages

## Setup
1. In Supabase, open Project Settings -> API.
2. Copy the Project URL and publishable key (or legacy anon key).
3. Paste them into `config.js`.
4. Host the folder on HTTPS (Vercel, Netlify, or another HTTPS host).
5. Sign in using an existing Supabase Auth user that has a matching `profiles` row.
6. Employee users also need an `employees` row whose `profile_id` is their Auth user UUID.

## Important limitations
This is a browser frontend starter, not a complete native background-tracking app.
Browser GPS tracking works only while the page is open and active enough for the browser to run it. It cannot guarantee tracking after closing the browser, force-stopping the app, or when the operating system suspends it.
For reliable background GPS on Android and iPhone, build a native employee app using Android foreground location services and iOS Core Location background location. Use a trusted backend for passkey/WebAuthn verification and secure employee provisioning.

The frontend calls these SQL RPC functions:
- `duty_in`
- `record_location`
- `duty_out`

The manager views rely on the RLS policies and tables created in the Supabase SQL setup.
