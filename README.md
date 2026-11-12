# Low Supply

A child taps a supply. Both parents get a notification. Either parent marks it ordered.
One web app with two faces, the parent app and the child app, picked when a device links.

## Run it on this Mac

    npm install
    npm run dev

Then open http://localhost:4350. The first run makes notification keys and keeps them in
`.env.local`, which git ignores. Families are saved as JSON files in `data/`.

To try all three roles on one Mac, use three browser profiles or private windows: one
sets up the family, the others link with the codes it shows.

## Checks

    npm test            the rules, with a fake clock and fake notifications
    npm run e2e         two parents and a child in a real browser, with axe (server must be running)
    npm run check:copy  the never-say list

## How it is put together

- `public/` is the whole app: plain HTML, CSS and JavaScript modules, no build step.
  `js/parent.js` and `js/child.js` are the two faces, `js/start.js` is install and linking.
- `lib/core.js` holds every rule and touches no storage or network. `lib/http.js` is the
  backend around it. `lib/store.js` saves to a folder here, or to Vercel Blob when deployed.
- `server.mjs` runs it locally. `api/[route].js` is the same backend as one hosted function.
- A device is linked by a code that works once, for one person, for 30 minutes. The device
  then holds a random token. The server keeps only a hash of it.

## What a deploy needs (not done yet)

Phones need https to install the app and to get notifications, so real use needs a host.
The folder is laid out for Vercel, like Family Shifts.

- **Environment variables:** `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (make a fresh pair
  for production, do not reuse the local ones), `BLOB_READ_WRITE_TOKEN` (comes with a
  private Blob store), `CRON_SECRET` (random), and `SETUP_CODE` (a word you choose, so a
  stranger who finds the address cannot start a family on your storage).
- **A clock:** reminders and check in nudges fire when something calls `/api/tick`.
  Locally the server does it every minute. Hosted, it needs a scheduler. Vercel's free plan
  only runs scheduled jobs once a day, so pick one: a paid plan, an outside pinger every
  few minutes, or accept that reminders also fire whenever any family device opens the app
  (they already do).
- **Typekit:** add the host name to kit uic8bwd or headings fall back to Inter.
- The Blob store code follows the Family Shifts pattern but has not been run against a
  real store yet. Test a save on the first deploy.

## Known limits of this version

- iPhone notifications only work after Add to Home Screen. The app walks through it.
- The link code is meant to ride along into the Home Screen app by itself. That step is
  not proven on a real iPhone yet. Typing the code always works.
- iPhones will not speak until the first tap after opening, so a check in question may be
  silent until the child touches the screen.
- The app icon is a placeholder (a box on the brand blue).
