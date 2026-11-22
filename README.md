# STJBS Teacher Appreciation Wall

A private gift from students to teachers. Each of the 500 paper positions belongs to a note in the **THANK YOU** lettering. Teachers can find their collection, open individual notes and print or download a keepsake. Student Council moderates the wall through a separate administrator sign-in.

## Run the local edition

Use Node.js 22.12 or later and npm. The local demo runs the compiled React application, Pages Functions and a synthetic D1 database through Wrangler.

```sh
npm ci
npm run build
npm run demo
```

Open [the local wall](http://127.0.0.1:8788) and use the demo passphrase `paper-garden`. Open [the local council desk](http://127.0.0.1:8788/admin) for the separate demo administrator sign-in. The demo fixture contains 500 invented notes for 41 teachers, including a 55-note collection for testing multi-page keepsakes.

```sh
npm run demo:reset
```

## Application and release

The browser interface is in `src/`, protected endpoints are in `functions/`, and the D1 schema is in `migrations/`. The teacher session and the council's Cloudflare Access identity are separate. Every protected read goes through the Functions layer.

Follow [the deployment runbook](setup.md) after approval. Production needs its own D1 binding, teacher passphrase, session secret, canonical host, Access configuration and allowlisted council identities. The owner supplies the approved note file privately. Keep private release inputs outside the checkout and static asset directory.

See [the build brief](docs/BUILD_PROMPT.md) for the full interaction and operating requirements.
