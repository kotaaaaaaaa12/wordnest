# Wordnest

An English–Japanese vocabulary app for Cloudflare Workers and D1. It includes quizzes, flashcards, learning statistics, optional accounts, rankings, and password-protected administration.

Use **Guide** for learning instructions and **Changelog** (`#/history`) for version history in English or Japanese. The current version appears in Settings and Changelog. Release notes are maintained in `public/changelog.js`. Entries before v1.9 reconstruct the early development history from older documentation and conversation records; their version numbers are editorial placeholders, explicitly labeled in both languages, and no unverified dates are assigned. This README covers deployment and operation.

## Deploy with Cloudflare Workers

1. Upload the contents of this folder to the root of a GitHub repository, including `wrangler.jsonc`, `package.json`, `package-lock.json`, `src/`, and `public/`.
2. Connect the repository to **Workers Builds** in the Cloudflare dashboard. Choose Workers, rather than a static-only Pages deployment.
3. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Root directory | Repository root |
   | Build command | Leave empty |
   | Deploy command | `npx wrangler deploy` |

4. Deploy. Wrangler automatically provisions the `DB` D1 binding on the first deployment. The first API request creates the tables. New installations start with no word sets. No manual SQL migration is needed. The deploy token must have permission to provision D1 databases.
5. Set the runtime secret **`ADMIN_PASSWORD`** to a strong password of **at least 12 characters**. In your deployed Worker's **Settings → Variables and Secrets**, add a **Secret** with that name and deploy the change. This must be a Worker runtime secret, not only a build environment variable.
6. Open the Worker URL. Everyone can practice. Enter the administrator password at the bottom of **Settings** to reveal **Edit** and create, import, export, change, or delete shared sets.

For CLI deployment:

```sh
npm ci
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
```

`public/vendor/fflate.js` is already included. No dashboard build command is required. Wrangler automatically runs the release script before deployment. If you update fflate, run `npm run build:vendor` before committing the vendor file.

### Existing D1 database

The shipped configuration intentionally omits a database ID to enable automatic provisioning. To explicitly use an existing database instead, replace the `d1_databases` array with your real database details:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "your-database-name",
    "database_id": "your-real-database-id"
  }
]
```

Keep the same binding/database for later deployments to preserve word sets. If auto-provisioning is unavailable for your account or token, create a D1 database in the dashboard, then use the explicit binding above. Do not change the database just to update application code.

## Study and appearance

- Navigation: Practice → Statistics → Rankings → Guide → Changelog. Administrator mode adds Edit and Administration.
- Quizzes: EN → JP uses four choices with 15 seconds per question; JP → EN uses typed answers with 20 seconds. Questions do not repeat within a round. Missed, skipped, and timed-out questions can be retried.
- Only a perfect **All** round completed without retries grants a set clear. Editing the same set preserves clears.
- Flashcards support both directions, taps, swipes, original/reverse/random order, saved positions, optional IPA, and device speech.
- Difficult words, Favorites, and Word search are available in Practice. Two consecutive misses register a difficult question; three consecutive correct answers remove it.
- Statistics includes eight measures, a seven-day chart, and a monthly calendar. Daily averages divide by study days. Accuracy rankings require at least 30 attempts.
- Language: Auto / English / Japanese. Appearance: Auto / Light / Dark, with five palettes per mode: Linen (Default), Ocean, Lavender, Apricot, and Sage in Light; Forest (Default), Midnight, Graphite, Ember, and Plum in Dark. Preferences are saved in each browser.

## Accounts and data

Accounts are optional. Use **Account** beside Settings to register or log in. Login IDs are private, case-insensitive, and contain 3–32 ASCII letters, digits, or underscores. Passwords require 15–128 characters. Public display names are separate and need not be unique. Account login never grants administrator access.

Registration transfers this browser's guest records. Logging into an existing account keeps guest records separate until **Transfer guest records from this device** is selected. A successful transfer merges the records, retires the separate guest identity, and removes acknowledged guest data from this browser. Use the browser holding those guest records to transfer them. **Sync now** alone does not import a separate guest profile.

Signed-in accounts sync study records across devices. Offline changes are retained for retry; repeated uploads and overlapping study time are deduplicated. Guest records remain browser-specific. Keep browser storage until records have synced or transferred successfully. Language, theme, sound preferences, and administrator access stay browser-specific.

Ranking participation controls public listing only. Learner records also sync privately for administrator access when public participation is off. Administrators can see the latest synced records; offline activity is unavailable until reconnection. Settings provides confirmed deletion of clear status, difficult words, favorites, statistics, or all learning data. Account data resets synchronize across devices.

## Administration and shared sets

Enter the runtime `ADMIN_PASSWORD` at the bottom of Settings to reveal Edit and Administration. Authentication lasts up to 30 days in that browser profile. Exit administrator mode in Settings; changing the secret invalidates existing administrator sessions. Shared word sets are stored in D1. Keep the same Worker and database when updating.

Edit supports set titles, English words, Japanese meanings, optional IPA and explanations, publication, creation, import/export, deletion, and saved display order. New sets start private; public sets are available to visitors, while private sets require administrator access. Save explicitly. Unsaved edits and stale concurrent saves require review. Limits: 200 sets, 1,000 words per set; title/English 150 characters, meaning 300, IPA 200, explanation 2,000.

Administration searches display names or private login IDs and shows individual statistics, charts, and calendars. Password resets invalidate learner sessions without changing their records. Forgotten passwords are reset by the administrator; recovery codes and email recovery are not used.

Three separate removal actions are available:

| Action | Result |
| --- | --- |
| Remove listing | Hides the public entry and sends your moderation message. Records remain; rejoining requires acknowledging the notice and changing the name. |
| Delete login account | Permanently deletes the server account and its synced data. Each device keeps its cached name and records as an independent guest when it reconnects. |
| Schedule learner deletion | Suspends learning, synchronization, and public ranking listing for seven days. A super administrator can cancel before the deadline. After the hold, the learner and records are permanently deleted; updated devices clear affected local data on reconnection. |

Deletion requires confirming the selected login ID or guest code. Offline devices are affected on their next updated-app connection. Permanent deletion is not a device ban; a learner can explicitly start a fresh identity later.

## Super administrator access

Set an additional Worker runtime secret named `SUPER_ADMIN_PASSWORD` with at least 12 characters, different from `ADMIN_PASSWORD`. For CLI setup, run `npx wrangler secret put SUPER_ADMIN_PASSWORD`. The ordinary secret keeps working if no super secret is configured. Enter either password in the Administrator mode field in Settings; ordinary administrators can also use **Use super administrator mode** there to elevate with the separate password.

Access is linked to the current guest identity or authenticated learner account. Accounts are not required. With `SUPER_ADMIN_PASSWORD` configured, new ordinary administrator identities must be approved by a super administrator after requesting access with the ordinary password. They enter the password again after approval; the pending cookie never gains access automatically. Existing approved identities and sessions survive this upgrade. Without a super secret, legacy password-only access remains enabled. Administration marks privileged learners; super administrators also see an access list with confirmed **Revoke administrator access** and **Restore administrator access** actions. Revocation invalidates existing sessions and blocks ordinary-password re-entry for that identity, including linked guest/account records. A dedicated private revocation notice appears on a connected visit and is retained until acknowledged, including when revocation happened while offline. Restoration requires entering the password again. Active pages check for revocation about every 30 seconds and on return/reconnect; protected API calls always check the server immediately.

Ordinary administrators cannot delete or reset another active administrator, and super administrators are protected from those administrative operations. Administrator privileges are not part of public ranking responses. Logging out revokes the current server session. Password rotation invalidates sessions issued with that role's previous password. Old stateless administrator cookies from earlier app versions require entering a password again after upgrading; study records are unchanged. Database tables are created automatically.

This is identity-based access control, not a hardware ban. Clearing browser data or using another browser creates a fresh guest identity; a new identity can request access but still needs approval when the super secret is configured. Rotate a shared password if it must no longer be known to a former administrator. Older API clients without learner credentials receive a separate anonymous administrator identity, also visible in the super administrator's access list.

## Notifications, sessions, and operation history

Administration offers **Send notification** for each learner. Provide Japanese and/or English text; the available language is used as fallback. Notices appear on a later connected visit without replacing another dialog, and learners can acknowledge or defer them. Recent notifications show acknowledgement status. Notices are separate from ranking-removal messages and are rendered as plain text. Sending preserves the editor text.

Registered learners open **Account → Signed-in devices** to review account sessions and sign out other sessions individually or together. Administrators can review a learner's account/administrator sessions and sign them all out, subject to role protections. Browser/device labels are approximate and each sign-in is a separate session. No raw session credentials or IP addresses are shown. Signing out retains cached learning records and does not revoke an approved administrator grant.

Super administrators open **Operation history** in Administration for paginated records of access requests/approvals, permission changes, set changes, account management, notifications, session revocation, and deletion scheduling/cancellation/finalization. Passwords, session credentials, and notification contents are never copied into the audit log. Names are resolved from current profiles rather than retained as snapshots after learner deletion.

## Seven-day learner deletion hold

**Schedule learner deletion** requires the existing typed ID/code confirmation. The learner's server data and device caches remain during the hold; learning and synchronization are suspended, and public rankings exclude the learner without changing the saved participation choice. **Pending deletions** is available to super administrators for confirmed cancellation before the deadline. Cancellation restores access/listing and preserves records. Login-account deletion and a learner's own Settings data resets remain separate operations.

The shipped hourly Cron Trigger finalizes due deletions, and API access also processes due entries. Finalization happens at or after the seven-day deadline; offline devices clear affected caches on their next updated-app connection. No manual SQL is needed. Keep the scheduled trigger enabled when deploying. Cancellation uses a per-request revision token and cannot reverse a completed deletion. Database guards reject in-flight registration/import/study writes for suspended identities. Old or offline clients cannot be forced to stop viewing previously cached content, but suspended writes are rejected by the server.

## Export and import

### Export

Enable editing in **Settings**, open **Edit → Export**, select one or more word sets, then choose **Export selected**.

- One set downloads as one `.json` file.
- Multiple sets download as a ZIP containing one JSON file per set.
- Select all exports the complete collection.
- The editor action bar has **Export draft** while a draft is open to download the current draft, including unsaved changes. An incomplete draft can be backed up but must be completed before it can be imported.

### Import

Enable editing in **Settings**, open **Edit → Import**, then select one or more JSON/ZIP files. Review the preview and select the sets you want to add. Importing always creates new copies and never overwrites existing sets. Sets are imported together as one database batch. If any selected set is invalid, the whole batch is rejected.

Supported JSON format:

```json
{
  "format": "wordnest-set",
  "version": 1,
  "title": "English words 1–50",
  "words": [
    {
      "english": "achieve",
      "meaning": "達成する",
      "ipa": "əˈtʃiːv",
      "explanation": "She worked hard to achieve her goal."
    }
  ]
}
```

`ipa` and `explanation` can be omitted. Optional `ipaItalic` stores half-open UTF-16 ranges into `ipa`, such as `[[0, 1]]` for an italic first character. IPA is displayed in square brackets; the brackets are not stored. `format` and `version` are export metadata. An array of sets or an object containing a `sets` array is also accepted. ZIPs must contain JSON files; unrelated files are ignored. Import accepts up to 100 sets at a time, under 2 MB of JSON in total, with up to 8 MB of input files. Set IDs and revisions are never imported, so backups can be moved between deployments.

## Sound files

Supply your own optional MP3 files before deploying:

```text
public/assets/audio/correct.mp3
public/assets/audio/incorrect.mp3
public/assets/audio/confetti.mp3
```

Missing files are ignored. Settings controls effects; device speech is separate. Perfect rounds trigger the celebration, with animation respecting reduced-motion preferences.

## Updates and caching

`npx wrangler deploy` runs `scripts/release.mjs` automatically. It reads the package version, updates the displayed app version, and adds a shared version/content query to browser scripts, styles, and transitive imports. Files stay in their existing directories. HTML uses `no-store`; application files revalidate. Already-open pages need a normal reload. Updates do not clear study data, cookies, or preferences.

The obsolete `public/releases` folder from v2.2.1 is removed during the build. Remove it from Git if it was previously committed. Add new release notes in both languages to `public/changelog.js`, bump `package.json` and its lockfile together, then run `npm run build:release` when preparing updated source files.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars
# Replace the example password in .dev.vars.
npm run dev
```

Local development uses a separate local D1 database. Do not commit `.dev.vars` or any real password.

## Validation

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

Tests cover study rules, account sync, D1 APIs, imports, bilingual UI flows, themes, and timing. Real Safari layout/audio and live deployment still need verification on the target devices.

## Main files

| Path | Purpose |
| --- | --- |
| `src/worker.js` | Worker API, administrator authentication, D1 bootstrap |
| `src/accounts.js`, `src/rankings.js` | Accounts, study sync, ranking and learner administration |
| `public/app.js` | Navigation and interactive UI |
| `public/core.js`, `public/personal.js`, `public/stats.js` | Study rules, personal collections, learning records |
| `public/changelog.js`, `public/i18n.js` | Bilingual release notes and interface messages |
| `public/styles.css`, `public/theme.js` | Responsive themes and initial appearance |
| `wrangler.jsonc` | Worker assets, automatic release build, D1 binding |

## References

- [Cloudflare automatic resource provisioning](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/)
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

fflate is distributed under its MIT license, included in `public/vendor/fflate-LICENSE.txt`.

The interface uses selected [Lucide](https://lucide.dev/) SVG icons with a consistent 24-unit grid and rounded 1.8-unit strokes. Only the icons used by this app are bundled; no CDN or icon font is loaded. Lucide and inherited Feather license notices are included in `public/vendor/lucide-LICENSE.txt`. After changing the selected icon list, run `npm run build:icons` and commit the generated module and favicon.

