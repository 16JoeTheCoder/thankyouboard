# STJBS Teacher Appreciation Wall

## Assignment

Build the complete application in one delivery. Use GPT-6.2 Astra on Medium for implementation. Start from the current `main`, create a review branch, and open a PR targeting `main` for Josef to approve. Use the repository's design tooling, including Impeccable when available. Assign independent QA to GPT-6.2 Sol subagents on Medium. The product is a read-only gift for staff, with a separate Student Council admin surface.

## 1. Board and visual direction

Use the kinetic paper-letter reference in [design references](design-references.md). The eight large **THANK YOU** letterforms are built from 500 fixed paper-note positions. Use mixed note sizes, a few offset paper edges, restrained shadows, and color blocks to make the letters read from a distance. The implementation is a live composition of addressable cards. Set positions and sizes deterministically, with an explicit slot map and legible letter silhouettes on both phone and desktop. A hidden note leaves a blank slot. Never render a fake note to fill it.

The current mockup looks lively, but unprinted colored faces read like craft material and stacked cards look inaccessible. Remedy both. Give medium/large cards a short real excerpt in printed type and a recognizable note treatment, such as a small ruled baseline and folded corner. Smaller cards use a legible paper silhouette. Keep the visual stack shallow and hit targets predictable. Hover or focus exposes a readable excerpt; tap opens the note directly on touch. Full messages appear in the reader. No teacher-facing note-writing button, fake school crest, or note text extracted from the mockups.

Place **Find my notes** above the board, with **Surprise me** alongside. Type a teacher name, show matching profiles, and highlight their cards briefly before opening a readable panel headed with their name. Provide **All notes** to reset and a browsable note view so tiny paper tiles are never the sole way to reach a message. Ordinary focus, labels, contrast, and dialog semantics still apply. Keep the mobile header compact and ensure the search is visible without scrolling. Use four visually distinct board themes, Original, After Hours, Blue Hour, and Garden, in a top-right control. Persist the theme locally. Show the Student Council dedication once after the first successful unlock, with an immediate **Open the wall** action and **Replay dedication** available later. Keep dedication copy configurable. Do not add teacher-specific links or a special event-display mode.

### Motion and performance

Use transform and opacity for a roughly 160–220 ms lift on the active card, with a small tilt and short reveal. Put any extra shadow on an active overlay and fade it. Keep the 500 base positions stable. Delegate pointer handling to the board, update state on active-card changes, and use at most one requestAnimationFrame update at a time if pointer-follow tilt is used. Avoid scroll-linked 3D scenes, idle loops, per-card layers or listeners, dynamic blur, and animating hundreds of elements together. On spotlight, move a small capped set of paper previews and restyle the remaining matches without continuous motion. Reduced motion removes tilt and travel and reveals the same content immediately. Cancel pending transitions on rapid reselection, closing, navigation, visibility changes, and reduced-motion changes. Touch users get direct taps. A desktop hover preview must never steal focus or intercept adjacent pointer targets.

Fetch the approved visible data once per board entry and use conditional refresh of its revision on focus, before export, and while a tab remains active. Evict changed or hidden items from all active views on refresh. Keep private content out of static files and shared caches. Load export dependencies when needed. Capture a browser performance trace while sweeping across the full 500-note board and switching teachers rapidly. At 4× CPU throttling, report delivered frames and long tasks, and fix sustained jank or any attributable task over 50 ms during the hover sweep. Confirm the idle board continuously animates nothing. Record browser, device or emulation, and evidence for claims.

## 2. Keepsake export

From a teacher's panel, **Save my notes** opens a single export workspace. Default to all of that teacher's visible notes selected, Gallery layout, and A4 portrait. Provide **Select all**, **Clear**, per-note checkboxes, selection count, a layout picker, paper size, and a large live preview. A note opened individually offers a shortcut that selects only that note. Disable export for an empty selection with a clear explanation.

Offer **Botanical**, **Rose Letter**, **Blue Ink**, **Gallery**, and **Letterpress** for every teacher. Distinguish them with typography and composition, using restrained ink coverage and print-safe margins. Offer A3, A4, A5, and A6. One selected note gets a large on-screen preview and a dedicated page with balanced whitespace and larger type. Long notes should size down gracefully while staying readable. Multiple notes paginate in stable order with clear separation, teacher name, and a discreet Student Council signature. Preserve spelling, punctuation, newlines, Chinese text and emoji where fonts support them, and quote the source text exactly. Handle overflow by flowing onto the next page. Add page controls when needed. Provide **Download PDF** and **Print** from the same paginated design. Verify output page dimensions and inspect rendered PDFs. Preserve Unicode and selectable text, and show a useful retry state on failure.

## 3. Server, data and access

Use React, TypeScript, Cloudflare Pages Functions and D1, unless the repository already has a compatible equivalent. Deliver a reproducible production build, local demo, database migrations, and deployment runbook. Deploy a private preview or use an authorized existing Cloudflare project when credentials and a target exist. Report the exact blocker when deployment cannot be verified.

Provide a one-time private seed command for the approved JSON, shaped as `{ "notes": [{ "id": "...", "teacher": "...", "text": "..." }] }`. Keep stable note identifiers, teacher display names and exact note text. Validate 500 distinct IDs, 41 teachers, and at least 3 per teacher before committing the seed. An identical rerun is idempotent and never overwrites moderation changes. The destination repository is public. The owner supplies the real file and chosen passphrase privately. Keep them out of Git history, commits, public previews, build output, static assets, and test artifacts. Include an isolated synthetic fixture with the same counts, including a 55-note group. No bulk import UI.

The teacher gate verifies a deployment secret server-side and issues a revocable 30-day browser session over HTTPS. Support sign out, reasonable throttling, and passphrase rotation with session revocation. Keep teacher access read-only and verify authorization on every protected read. Use named admin identities and authorize every mutation separately. For example, validate a configured Cloudflare Access identity and administrator allowlist at the application boundary. Keep the clearly labeled demo's credentials and test data isolated from production. Avoid logging note bodies or secrets.

## 4. Admin recovery

| Situation | Admin behavior |
| --- | --- |
| Harmful or misdirected note | Find by teacher, text, status or note ID. Hide or reassign immediately. Active views refresh, and hidden content is excluded from board, search, random and export. |
| Incorrect edit or accidental hide | Show previous revisions and who changed them. Restore a specific revision with a diff. Warn if a hide or reassignment takes a teacher below three visible notes and allow urgent moderation to proceed. |
| New note or full board | Add for any teacher and fill the first empty slot in a stable order. If full, explain how to free a slot. Prefer the original slot on restore when free, otherwise use the next blank. Never overwrite another note. |
| Two admins edit or fill the last slot | Use transactional writes and revision checks. Preserve unsaved input and offer refresh or retry when conflicts occur. Keep capacity enforced on the server. |
| Lost connectivity or persistent failure | Preserve unsaved input in the open editor, report whether the operation completed, and make retry safe. Show a data-health view with counts and recent actions. |
| Passphrase leaks or an admin leaves | Provide session revocation and an Access view with secret-rotation and identity-removal instructions. Never show the secret. |
| Larger data mistake | Provide authenticated, versioned backup and recovery with a dry-run diff. Highlight previously hidden notes a restore would republish and require explicit confirmation for those notes. |

## 5. Preview and independent release checks

Build with `npm run build` and serve the compiled assets plus real local Functions and a separate synthetic D1 dataset using a documented `npm run demo` command based on Wrangler. Provide a one-command reset for the demo database. Use Codex browser or Chrome/Edge to review the real demo at desktop and phone sizes. For repeatable tests, invoke a JavaScript browser runner through npm, using Playwright's Node API or Puppeteer when browser support is available. Do not depend on the Playwright CLI. If loopback is inaccessible in the browser tool, use authorized port forwarding or an isolated preview with synthetic data only. If neither works, report browser QA as blocked and continue server/unit checks independently.

Give separate GPT-6.2 Sol Medium subagents fresh QA context and assign these passes.

1. **Board and UX.** Verify the gate-to-wall flow, first-run dedication and replay, four themes, teacher spotlight, keyboard focus and touch navigation. Repeat fast teacher selection and hover, inspect reduced motion and test at 390 px and desktop widths. Capture desktop and phone screenshots and the performance trace.
2. **Admin and data.** Verify unauthenticated access, teacher/admin role boundaries, 30-day session persistence and revocation, hide propagation, write failure, concurrent slot allocation, retries, and restoration at capacity. Verify stable slot IDs and no leaks through public assets or fixtures.
3. **Export.** Test one note, a sparse selection, and all 55 notes. Exercise five layouts and four paper dimensions through programmatic PDF checks, with visual sampling of every layout and paper size. Inspect A6 overflow, long and mixed-script notes, page breaks, hidden-note exclusion, no horizontal clipping, and exact selections.

Each pass returns observed results with commands, screenshots, PDFs or traces, and reproduction steps for failures. Astra fixes and reruns failed checks. End with PR URL, preview instructions or URL, and any remaining owner-only deployment inputs. Do not merge the PR.
