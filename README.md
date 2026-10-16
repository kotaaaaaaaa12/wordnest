# Wordnest

A responsive English vocabulary quiz app for Cloudflare Workers + D1. Includes English/Japanese UI, a password-protected editor, shared word sets, and JSON/ZIP import and export. No container, R2 bucket, or email service is needed.

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
6. Open the Worker URL. Everyone can practice and export word sets. Open **Edit** and enter the password to create, import, change, or delete shared sets.

For CLI deployment:

```sh
npm ci
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_PASSWORD
```

`public/vendor/fflate.js` is already included. No frontend build step is required. If you update fflate, run `npm run build:vendor` before committing the vendor file.

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

## Settings and appearance

Open **Settings** from the sidebar or the gear button in the mobile header.

- Appearance: **Auto**, **Light**, or **Dark**. Auto follows the device theme. Your choice is remembered on this browser and applied before the page is painted.
- Language: **Auto**, **English**, or **日本語**.
- Sound: enable or disable quiz effects.
- Word sets and backups: **Import**, **Export**, and editing tools. Unlock Edit before importing or creating a set. **New set** appears only inside Settings while Edit is unlocked.

Practice cards contain no export checkboxes or New set buttons. The editor keeps backup and creation actions in Settings as well. Focus outlines and focus shadows are suppressed throughout the interface, including modal headings and buttons.

When upgrading from version 1.0, the untouched automatically generated starter set is removed once. A starter set that was edited or renamed is preserved, along with all user-created and imported sets. No example sets are automatically added afterward.

## Sound files

Place your files at these exact paths before deploying:

```text
public/assets/audio/correct.mp3
public/assets/audio/incorrect.mp3
public/assets/audio/confetti.mp3
```

The application requests them as `/assets/audio/correct.mp3`, etc. Missing audio files are ignored. The Sound toggle is saved on each browser. Perfect-score audio plays when the user opens the final results; confetti falls from the top of the screen. The animation respects the reduced-motion setting. No audio files are bundled.

## Practice

1. Choose a word set.
2. Choose **EN → JA** (four choices) or **JA → EN** (typed answer).
3. Choose **5**, **10**, **15**, **All**, or **Custom**. Counts greater than the available unique questions are disabled.
4. Answer once, review the correct answer and optional explanation, then continue. “I don't know” counts as incorrect.
5. Review the score and every question. A perfect score triggers the celebration.

Questions are shuffled without replacement. EN → JA uses three distinct meanings from other entries in the same set. It requires at least four distinct meanings; smaller sets still support JA → EN. An English word may appear only once within a set. In JA → EN, identical Japanese meanings form one question, and every English word mapped to that meaning is accepted. Therefore, the unique question count can differ between modes.

Typed answers ignore capitalization, surrounding/repeated spaces, full-width Latin characters, and curly-versus-straight apostrophes. Spelling otherwise needs to match. Enter one accepted English word or phrase, not a slash-separated list.

## Editing and shared storage

- Word sets are shared across browsers and stored in D1, not in local storage.
- The editor supports a title, English word, meaning, and optional explanation.
- Save changes explicitly. Saving keeps the editor open.
- Switching sets or pages with unsaved edits opens a confirmation dialog. Closing/reloading the page uses the browser's native unsaved-changes warning when supported.
- A signed, HttpOnly cookie remembers editor authentication for up to 30 days in the authenticated browser profile. Other browsers/profiles need the password separately. This is browser authentication, not hardware-device attestation.
- Lock editor clears that browser's cookie. Changing `ADMIN_PASSWORD` invalidates every existing editor session.
- The server checks authentication for every write, validates all imported data, rejects cross-origin writes, and limits password attempts per client IP to 10 in a 15-minute window.
- Concurrent edits are checked using revision numbers. A stale save/delete is rejected. Export your draft before refreshing to preserve your work.
- Up to 200 sets and 1,000 words per set are supported. Titles: 150 characters. English: 150. Meaning: 300. Explanation: 2,000.

The quiz content is public to visitors who can access the Worker URL. The editing password protects modifications; it does not hide the vocabulary data.

## Export and import

### Export

Open **Settings → Export**, select one or more word sets, then choose **Export selected**.

- One set downloads as one `.json` file.
- Multiple sets download as a ZIP containing one JSON file per set.
- Select all exports the complete collection.
- Settings has **Export draft** while a draft is open to download the current draft, including unsaved changes. An incomplete draft can be backed up but must be completed before it can be imported.

### Import

Unlock Edit, open **Settings → Import**, then select one or more JSON/ZIP files. Review the preview and select the sets you want to add. Importing always creates new copies and never overwrites existing sets. Sets are imported together as one database batch. If any selected set is invalid, the whole batch is rejected.

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
      "explanation": "She worked hard to achieve her goal."
    }
  ]
}
```

`explanation` can be omitted. `format` and `version` are export metadata. An array of sets or an object containing a `sets` array is also accepted. ZIPs must contain JSON files; unrelated files are ignored. Import accepts up to 100 sets at a time, under 2 MB of JSON in total, with up to 8 MB of input files. Set IDs and revisions are never imported, so backups can be moved between deployments.

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

Tests cover randomized nonrepeating quizzes, distinct distractors, duplicate-meaning handling, bilingual message parity, ZIP/JSON round trips, password authentication and rate limiting, D1 writes and revisions, atomic import validation, simulated UI flows, theme switching, modal focus styling, and safe removal of the legacy example. Real Safari layout/audio playback and a live Cloudflare account deployment must be checked in the target environment.

## Project layout

```text
src/worker.js             Worker API, authentication, D1 persistence
public/index.html         Application shell
public/app.js             Quiz, editor, import/export, sound, celebration
public/core.js            Shared validation and quiz rules
public/i18n.js            English/Japanese UI messages
public/styles.css         Responsive light/dark styles
public/theme.js           Theme setup before the first paint
public/assets/audio/      Your three optional MP3 files
public/vendor/            Bundled fflate module and license
wrangler.jsonc            Workers deployment and D1 binding
```

## References

- [Cloudflare automatic resource provisioning](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/)
- [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

fflate is distributed under its MIT license, included in `public/vendor/fflate-LICENSE.txt`.
