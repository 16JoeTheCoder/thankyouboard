# Cloudflare deployment runbook

This runbook is for the owner’s Claude Code terminal agent to execute later, once the application is approved for deployment. The Codex build task ends after implementation and local simulation.

Deploy the approved Teacher Appreciation Wall from start to finish using the attached Cloudflare credential, Wrangler and the Cloudflare API. The owner should only need to complete a Google OAuth Console step if the correct OAuth client is missing or its redirect settings need updating. This repository is public. Keep live notes, credentials, administrator emails and account-specific values out of Git and public preview output.

## Application settings

The production Pages configuration is `wrangler.toml`. It declares the `DB` D1 binding and `dist/` output. Its database ID is a placeholder. Provision the real database first and supply its ID in a private release configuration. The local demo has its own database and loopback-only identity flow.

| Binding | Production value |
| --- | --- |
| `TEACHER_PASSPHRASE` | The privately chosen shared passphrase |
| `SESSION_SECRET` | An independent, randomly generated secret |
| `ADMIN_HOST` | Exact canonical school hostname, without scheme or path, used for both teacher and council requests |
| `ACCESS_ISSUER` | Exact HTTPS Zero Trust team origin, without a trailing slash |
| `ACCESS_AUD` | Audience tag for this Access application |
| `ADMIN_EMAILS` | Comma-separated named Google identities approved by the owner |
| `DEDICATION` | Optional Student Council dedication text |

Leave `LOCAL_DEMO` unset on Cloudflare. Apply Access to `/admin`, `/admin/*`, `/api/admin` and `/api/admin/*`. Teacher APIs under `/api/` perform their own session checks. Rotating either teacher secret invalidates existing teacher session tokens.

## 1. Resolve the account and release inputs

- Start at the approved commit. Read [the build prompt](docs/BUILD_PROMPT.md), the lockfile, package scripts, and actual Wrangler config. Record the Pages project name, output directory, D1 binding name, admin routes and entry commands. Verify the app implementation, production build, migrations and private seed command exist before creating live resources. Use the real app's declared names if they differ from examples here.
- Use the attached credential from its secure environment or connected Cloudflare tooling. Prefer `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for Wrangler and a Bearer token for REST. If the attachment is a Cloudflare Global API key, use its account email and the REST `X-Auth-Email` and `X-Auth-Key` headers, or the corresponding supported Wrangler authentication. Never print credentials, embed them in command strings or tracked config, or switch accounts silently.
- Discover the correct account, intended Cloudflare zone and host, existing Pages project, D1 databases and Zero Trust team. Confirm access for each needed operation without changing unrelated settings. Use a dedicated app hostname inside the existing zone if the target is unambiguous. Preserve unrelated DNS, projects and Access apps. If multiple accounts or hosts are plausible, ask only for the precise target.
- Locate the approved seed JSON, teacher passphrase and named admin Google emails from private release inputs. Request missing private values together. Obtain an approved Google identity for an end-to-end smoke test, or ask the owner to perform the single interactive sign-in if their identity is unavailable to the agent.
- Run `npm ci`, the repository's checks, and `npm run build`. Run the synthetic local demo and QA from the build prompt. Check that preview and production configs use separate bindings, data, credentials and Access applications where both are remotely deployed. Keep synthetic fixtures out of production.

## 2. Set up Cloudflare Access with Google

Teacher access uses the 30-day shared-passphrase flow. Google sign-in through Cloudflare Access is for named council administrators. Enforce both the edge policy and the app's server-side admin checks.

1. Find the existing Zero Trust team and its Access team domain through Cloudflare. Reuse the team's approved Google identity provider if its configuration is correct and authorized for this app. If Zero Trust is absent, provision it through available account tooling within this app's scope, or report the precise account prerequisite. Do not rename an existing team.
2. If the Google OAuth client requires configuration, give the owner the **actual** team domain and exact values below. In Google Cloud Console open **Google Auth Platform → Clients**, select the existing **Web application** client, and add the missing entries. If no appropriate client exists, create one and configure the project's Branding and Audience. Make sure the intended admin accounts are eligible, including test users when the selected Google audience configuration requires them. Existing Google Search Console verification is useful for domain verification. The OAuth client still requires its own origin and callback entries.

   | Google field | Required value |
   | --- | --- |
   | Authorized JavaScript origins | `https://<team-name>.cloudflareaccess.com` |
   | Authorized redirect URIs | `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` |

   Keep any existing redirect URIs in a shared client. If Cloudflare lacks a working provider, obtain the Google Client ID and Client Secret through secure input. Use the Cloudflare identity provider API to create an app-appropriate provider of type `google` with those credentials. Reuse existing credentials if already configured and valid. A Cloudflare credential cannot change the Google project. Complete Cloudflare-side work through the API and resume as soon as the Google-side inputs are available. [Cloudflare Google integration](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/) · [Google OAuth client settings](https://support.google.com/cloud/answer/15549257) · [Cloudflare identity providers API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/)
3. Create or update the app-specific **self-hosted Access application** through the account API. Cover the actual admin UI and every admin API path on the production hostname, including the bare route and descendants (for example `/admin`, `/admin/*`, `/api/admin`, `/api/admin/*`). Keep public static assets and the teacher passphrase flow usable. Restrict login to the intended Google provider and explicitly allow the named council admin emails. Avoid broad allow, bypass policies and shared admin identities. Configure any protected preview separately. [Cloudflare self-hosted Access applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
4. Set the team issuer and Access application audience from the actual app. Validate the `Cf-Access-Jwt-Assertion` on all admin reads and writes server-side against Cloudflare's rotating public keys, including signature, expiry, exact issuer, correct audience and allowlisted email. Enforce hostname and app boundary so the production `pages.dev` origin and preview aliases cannot bypass authorization. If the route has a missing provider, wrong audience or missing identity, it must deny access. [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 3. Provision storage, bindings and secrets

- Find or create the app's D1 database and record its name and ID. For an existing production database, record migration state and an appropriate D1 backup or Time Travel recovery point before schema changes. Bind the exact name expected by the app to the production database. Bind a separate database for remote preview or leave preview unseeded. Keep production IDs from being used in local scripts.
- Apply migrations in order on the explicit target. The typical Wrangler command is `npx wrangler d1 migrations apply <production-db-name> --remote` using the repo's production config. Confirm the pending migration list after applying. Check that new schema stays compatible with the rollback deployment or record database recovery separately. [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- Set production secrets using Pages secret bindings via Wrangler or the API. Supply the agreed teacher passphrase, app session signing secret and any other app-required values. Supply the Access issuer and audience as server-only configuration. Use secure stdin or the platform's secret channels. Do not commit dotenv files, Google credential exports or release datasets. [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)
- Execute the repo's private seed command against the explicit production D1 target. Validate 500 distinct approved notes, 41 teachers and a minimum of three per teacher at first seed. Record counts only. Preserve staff changes on redeploy and use the idempotent command for safe retries. Confirm no production data appears in previews, browser bundles or logs.

For the initial private import, use the approved JSON outside the checkout, and pass the private configuration and production database explicitly.

```sh
npm run seed:private -- --file /private/approved-notes.json --database <production-db-name> --config /private/wrangler.toml --remote
```

Resolve `pages_build_output_dir` and `migrations_dir` relative to the private configuration file, or use absolute paths there. An identical import preserves subsequent moderation. Use authenticated backup recovery for later content changes.

## 4. Deploy and attach the domain

1. Reuse the existing authorized Pages project if present and inspect its deployment mode. For a new project, prefer Wrangler Direct Upload with the approved production branch and explicit project name. This keeps deployment executable without requiring a Git integration setup. Preserve an existing Git integration and use its authorized workflow or supported deployment API. Never silently recreate the project. [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
2. For Direct Upload, deploy the compiled output from the repository root so Pages picks up the Functions directory. The typical command is `npx wrangler pages deploy <output-dir> --project-name <project> --branch main` once branch, bindings, and environment are confirmed. Verify the Functions deployed along with static files. Confirm the deployment ID and production commit. Keep private-data routes fail-closed before exposing the custom hostname.
3. Attach the approved hostname to the Pages project through the Pages domains API and verify the associated DNS record, using the DNS API if needed. Add the Pages hostname association before relying on a CNAME. Leave unrelated records intact. Wait for reported active domain state, DNS resolution and valid TLS. Only then use the final canonical URL for the teacher link and QR. [Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
4. Confirm Cloudflare Access policies are in effect across every admin destination. Verify the app independently rejects admin aliases or direct requests that lack the valid intended Access token.

## 5. Verify release and report

- Test from a fresh, unauthenticated browser. Check closed note APIs, correct and incorrect passphrase behavior, expiry and revocation, QR target, first-visit dedication, teacher search, note opening and portrait A4 PDF output.
- Verify unauthenticated admin UI and API requests are denied or challenged. Confirm an approved Google identity reaches admin and an unapproved Google identity cannot use it. Exercise edit, hide, recovery and export exclusion with synthetic preview data or an explicitly designated test note. Avoid modifying approved real notes during smoke tests.
- Check every alternate hostname and preview for leaked production data or a path that skips Access. Confirm production note and teacher counts through a protected check. Record browser results, deployment ID, migration status, and canonical teacher and admin URLs without sharing secrets.
- If an application deploy fails, restore the last verified production deployment or redeploy its pinned commit. Review database compatibility before rollback. For a data problem, use the documented backup and restore preview, then recheck all note and access gates. The first release has no prior production build, so keep live data gated and repair forward. [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)
- Complete all authorized Cloudflare steps even when Google configuration is pending. If blocked, report the exact failing step, completed resources, whether production is live, and the single next action required. Never describe a deploy or OAuth sign-in as verified without observing it.
