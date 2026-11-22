# Independent admin and data QA

The compiled build passed all 13 scenarios in `npm run qa:admin` using Wrangler 4.166.0, isolated local D1, Node.js 24.22.3, and Chromium 156.0.8078.79 through Puppeteer's Node API. Browser viewports were 1440 × 1000 and touch-emulated 390 × 844. The seed contained 500 visible notes and 41 teachers. The largest teacher group contained 55 notes.

## Reproduce

From the repository root, start a fresh synthetic instance in one terminal and wait for Wrangler to report ready.

```sh
npm ci
npm run build
npm run demo -- --port 8792 --state "$(mktemp -d /tmp/stjbs-admin-qa.XXXXXX)"
```

In another terminal, run the suite and keep its transcript alongside the screenshots. Set `CHROME_PATH` if Chromium is installed outside `/usr/bin/chromium`. The suite defaults to `http://127.0.0.1:8792` and `.qa/admin`. Override those with `ADMIN_QA_URL` and `ADMIN_QA_ARTIFACTS` when using another isolated loopback instance.

```bash
mkdir -p .qa/admin
set -o pipefail
npm run qa:admin | tee .qa/admin/results.log
```

Each run exercises saves, restores, and session revocation. Use a fresh temporary state directory or stop the demo and reset that same directory before repeating the suite.

## Observed results

| Area | Observation |
| --- | --- |
| Access | Anonymous requests and cross-role reads and writes were denied. An identity header alone granted no access. A cross-origin administrator mutation was denied. Browser reload retained the 30-day teacher session. Sign-out and council revocation invalidated existing cookies. A new unlock worked after revocation. |
| Data isolation | Protected board responses used private caching directives and revision ETags. A conditional request without a teacher session was denied. Compiled assets contained neither the tested synthetic excerpts nor the demo passphrase. |
| Moderation | Hiding a note left the other 499 slots in place. The admin warned before the hide brought the teacher below three visible notes, then offered direct navigation to the hidden-note filter. Focusing an already-open teacher wall removed the card and its reader. The updated teacher profile exported the remaining two notes. |
| Failed writes | The first save was interrupted before reaching the server. The second reached D1 but lost the browser response. Both interruptions kept the draft open. The third attempt used the same request ID and completed without creating another revision. |
| Concurrent writes | A pair of adds to the last slot produced one winner, one rejected write and 500 distinct occupied slots. Concurrent edits produced one accepted revision and one stale edit. A retry with the new revision succeeded. |
| Revision restore | The first hide recorded the original seeded note and the acting identity. Restoring that before snapshot reclaimed its original slot when available, failed at full capacity, and used the only free alternate slot after a second note was hidden. |
| Backup and recovery | A duplicate slot and stale preview were rejected. The preview left the wall unchanged and identified republished content. Restore required approval for that specific hidden note. A separate confirmed recovery changed all 500 notes, replayed without duplicate changes, and then restored their exact text and slots from the original snapshot. |
| Admin shell | All six routes opened on desktop. The collapsed sidebar persisted through reload and exposed its label on keyboard focus. On phone, the touch drawer navigated and closed without horizontal overflow. |

The first review found that the change-history restore used only the saved after snapshot. A freshly seeded note had no earlier history row to restore. The server and UI now support restoring either side, and the runner verifies restoration from the before snapshot of the first hide.

## Evidence

The runner writes `overview-desktop.png`, `navigation-phone.png`, `editor-write-failure.png`, `active-wall-after-hide.png`, and `export-after-hide.png` in its local artifact directory. These artifacts use synthetic data and are ignored by Git.

A separate HTTPS Wrangler run on `127.0.0.1:8797` used a fresh migrated database, local test bindings, `ADMIN_HOST=127.0.0.1`, and no `LOCAL_DEMO` or Cloudflare Access bindings. Bare and nested admin routes and admin APIs returned 403 with an identity header alone. The demo sign-in returned 404 and the session endpoint omitted the demo passphrase. The teacher cookie included `Secure`, `HttpOnly`, `SameSite=Strict`, and `Max-Age=2592000`. The alternate hostname rejected the same cookie and the eleventh consecutive wrong passphrase attempt returned 429. The local transcript is `.qa/admin/https-boundary.log`.

Live Cloudflare Access, Google identities, managed D1 performance, and expiry after an actual 30-day interval remain unverified. The local run verified the declared cookie lifetime and revocation behavior.
