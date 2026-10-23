# Wordnest

A responsive English vocabulary quiz and flashcard app for Cloudflare Workers + D1. Includes English/Japanese UI, a password-protected editor, shared word sets, and JSON/ZIP import and export. No container, R2 bucket, or email service is needed.

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

## Simple layout

The Practice page starts with a compact Sets / Difficult words / Favorites / Word search switch, followed by the selected view. Sets opens directly to the word-set heading, search field, and set cards. Promotional headings, welcome messages, decorative illustrations, sidebar slogans, and the footer are removed. Setup screens use short labels for the study mode, direction, question count, and card order. The light/dark palette stays the same.

## Guide tab

Public navigation is Practice → Statistics → Rankings → Guide. Authenticated administrators also see Edit and Administration as the fifth and sixth tabs. Guide is available at `#/guide`, including before word sets finish loading. It follows the selected English/Japanese UI language and explains quizzes, flashcards, personal study tools, clear colors, statistics, settings, and sound effects. Editing, transfer, and administration instructions appear only for authenticated administrators, after the Settings section. On mobile, the public tabs share their own row below the brand and Settings button. On narrow screens, the six administrator tabs use two rows of three.

## Settings and appearance

Open **Settings** from the sidebar or the gear button in the mobile header.

- Appearance: **Auto**, **Light**, or **Dark**. Auto follows the device theme. Your choice is remembered on this browser and applied before the page is painted.
- Light theme: **Default**, **Ocean**, or **Lavender**.
- Dark theme: **Default**, **Midnight**, or **Graphite**.
- Language: **Auto**, **English**, or **日本語**.
- Sound: enable or disable quiz effects.

The original default light and dark palettes are unchanged. Light and dark theme choices are saved separately on this browser; Auto switches between those saved choices. Theme preferences are applied in the document head before the page is painted. Favorite stars have a solid yellow fill in every theme. Clear-status colors keep their established meanings across palettes.

Settings contains no word-set management actions. Its bottom Administrator mode section accepts the existing `ADMIN_PASSWORD`, reveals Edit and Administration after successful server authentication, and offers Exit administrator mode while authenticated. Use the navigation tabs to open Edit or Administration. There is no password wall on the Edit page; anonymous `#/edit` links return to Practice. After enabling administrator mode, the toolbar contains **New set**, **Import**, **Export**, and **Manage sets**. Exit administrator mode is available only in Settings.

Practice cards contain no export checkboxes or New set buttons. The editor provides creation and backup actions directly; they remain hidden while administrator mode is inactive. Focus outlines and focus shadows are suppressed throughout the interface, including modal headings and buttons. Direction cards have no sticky hover highlight, and pointer clicks do not leave the selected button focused.

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
2. Choose **Flashcards** or **Quiz**.
3. Choose **EN → JP** or **JP → EN**. For a quiz, EN → JP uses four choices and JP → EN uses a typed English answer.
4. For a quiz, choose **5**, **10**, **15**, **All**, or **Custom**. Counts greater than the available unique questions are disabled.
5. Answer within **15 seconds per question**, review the correct answer and optional explanation, then continue. “I don't know” counts as incorrect.
6. Review the score and every question. A perfect score triggers the celebration.
7. If at least one answer was incorrect, choose **Retry missed questions** to practice only those questions, including skipped and timed-out answers. Every retry question gets a fresh 15 seconds. The question order and multiple-choice option positions are shuffled; the original distractors and explanations are preserved, even if only one question needs review.

A retry has its own score and is labeled as a mistake retry. If you still miss questions, retry again to narrow the next round to only the remaining mistakes. A perfect retry triggers the celebration and hides the retry button. **Practice again** returns to the full set's question-count picker.

Questions are shuffled without replacement. EN → JP uses three distinct meanings from other entries in the same set. It requires at least four distinct meanings; smaller sets still support JP → EN. An English word may appear only once within a set. In JP → EN, identical Japanese meanings form one question, and every English word mapped to that meaning is accepted. Therefore, the unique question count can differ between modes.

The timer appears above each question with a shrinking green-to-yellow-to-red bar and a small remaining-seconds display. Answering stops the clock; explanations have no time limit. Timing continues while Settings or a confirmation dialog is open and while the page is in the background. If time runs out, the question is marked incorrect, the answer is revealed, and Next becomes available. A late click or typed submission cannot count as correct after the deadline. Every new question starts with a fresh 15 seconds. Flashcards have no time limit.

Typed answers ignore capitalization, surrounding/repeated spaces, full-width Latin characters, and curly-versus-straight apostrophes. Spelling otherwise needs to match. Enter one accepted English word or phrase, not a slash-separated list.

## Flashcards

After choosing **Flashcards** and a direction, choose **Original order**, **Reverse order**, or **Random order**, then open the deck.

- Tap or click the card to flip between its front and back.
- EN → JP shows English on the front and Japanese on the back. JP → EN reverses these sides.
- Swipe left for the next word and right for the previous word. Previous/Next buttons and the left/right arrow keys also work.
- Press Space or Enter while the card is focused to flip it. A swipe does not also trigger a flip; vertical scrolling and cancelled gestures do not advance the deck.
- Every new card starts on its front. The first and last cards have fixed boundaries; navigation does not wrap around.
- All registered words are included once, even when several English words share a meaning. The four-distinct-meanings requirement applies only to the multiple-choice quiz.
- Random order is shuffled once when the deck opens. Moving backward revisits the same cards in the same session order.
- Optional explanations appear after revealing the answer. Change order returns to the order picker; Return home exits the deck.
- Viewing or shuffling a deck does not modify the saved word order. Flashcards do not produce quiz scores or celebrations.

## Editing and shared storage

- Enable administrator mode with the administrator password at the bottom of Settings. Authentication reveals Edit, Administration, and their guides; ending administrator mode or an expired-session response hides them. Unsaved drafts remain in memory after session expiry and can be resumed after authenticating again.
- Word sets are shared across browsers and stored in D1, not in local storage.
- The editor supports a title, English word, meaning, optional pronunciation (IPA), and optional explanation.
- Save changes explicitly. Saving keeps the editor open.
- Switching sets or pages with unsaved edits opens a confirmation dialog. Closing/reloading the page uses the browser's native unsaved-changes warning when supported.
- A signed, HttpOnly cookie remembers editor authentication for up to 30 days in the authenticated browser profile. Other browsers/profiles need the password separately. This is browser authentication, not hardware-device attestation.
- Exit administrator mode clears that browser's cookie. Changing `ADMIN_PASSWORD` invalidates every existing editor session.
- The server checks authentication for every write, validates all imported data, rejects cross-origin writes, and limits password attempts per client IP to 10 in a 15-minute window.
- Concurrent edits are checked using revision numbers. A stale save/delete is rejected. Export your draft before refreshing to preserve your work.
- Up to 200 sets and 1,000 words per set are supported. Titles: 150 characters. English: 150. Meaning: 300. IPA: 200. Explanation: 2,000.

The quiz content is public to visitors who can access the Worker URL. The editing password protects modifications; it does not hide the vocabulary data.

## Delete and reorder word sets

Enable editing in **Settings**, open **Edit**, then open **Manage sets**.

- Use the up/down buttons to change the display order, then choose **Save order**. The saved order applies to the Practice page, Edit list, and export picker on every browser after loading the current collection.
- Saving a word's content does not move its set. New sets and imported sets are added above the existing collection.
- Closing with an unsaved order asks whether to discard that order. Saving keeps the management dialog open.
- The trash button opens a confirmation. Confirming deletes the set immediately, independently of saving the display order. Cancelling an order change does not restore sets already deleted.
- Deleting the currently edited set also discards that set's draft, with a warning when it has unsaved edits. Drafts for other sets are preserved.
- The server validates the complete set list and checks the collection revision. A stale reordering request cannot silently overwrite changes from another browser.
- Existing installations automatically get a persistent display order based on their previous visible order. No manual migration is required.

Delete sets through **Edit → Manage sets** after enabling administrator mode.

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

`ipa` and `explanation` can be omitted. `format` and `version` are export metadata. An array of sets or an object containing a `sets` array is also accepted. ZIPs must contain JSON files; unrelated files are ignored. Import accepts up to 100 sets at a time, under 2 MB of JSON in total, with up to 8 MB of input files. Set IDs and revisions are never imported, so backups can be moved between deployments.

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

Tests cover randomized nonrepeating quizzes, distinct distractors, duplicate-meaning handling, bilingual message parity, ZIP/JSON round trips, password authentication and rate limiting, D1 writes and revisions, atomic import validation, simulated UI flows, theme switching, modal focus styling, flashcard directions and ordering, swipe/cancel/keyboard navigation, safe removal of the legacy example, and deadline-based quiz timeouts including background resumption and late submissions. Real Safari layout/audio playback and a live Cloudflare account deployment must be checked in the target environment.

## Project layout

```text
src/worker.js             Worker API, authentication, D1 persistence
src/rankings.js           Ranking profiles, validated aggregation, public boards
public/rankings.js        Browser identity, preferences, serialized sync/retry
public/index.html         Application shell
public/app.js             Quiz, editor, import/export, sound, celebration
public/core.js            Shared validation and quiz rules
public/i18n.js            English/Japanese UI messages
public/icons.js           Selected, bundled Lucide SVG icons
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

The interface uses selected [Lucide](https://lucide.dev/) SVG icons with a consistent 24-unit grid and rounded 1.8-unit strokes. Only the icons used by this app are bundled; no CDN or icon font is loaded. Lucide and inherited Feather license notices are included in `public/vendor/lucide-LICENSE.txt`. After changing the selected icon list, run `npm run build:icons` and commit the generated module and favicon.

### Flashcard text layout

Flashcards grow to fit the longer face, so full meanings remain readable in both directions. Both faces share a grid cell to keep the card height stable when flipping. Long content uses normal page scrolling rather than a clipped inner scroll area. The Japanese UI calls this mode “単語カード”.

The main content starts at the top of the page, with horizontal centering only. Set icons start gray, become orange after an EN → JP clear, purple after a JP → EN clear, and green after both directions are cleared. A text label and check/trophy icon also identify the state.

### Quiz clear progress

Clear progress is saved in this browser for each word set and quiz direction. Only rounds started with All selected can earn a clear. Only completing the original All round perfectly, without any mistakes or retries, earns the direction clear. Missed-question retries never earn clears, including retries from an All round. Fixed counts and Custom never qualify, even when their count equals the full pool size. Incomplete or incorrect rounds and flashcards do not qualify. Legacy clear records without first-pass All provenance are ignored because earlier records cannot distinguish clears earned through retries. Clears remain earned after later mistakes. Progress survives reloads and is separate from the shared word sets in D1; it is not included in set exports. Editing English words or meanings invalidates the clear state. Renaming, changing explanations, and reordering preserve it. Previous sessions cannot be recovered because earlier versions did not store results.

Japanese UI instructions, confirmations, and errors use a consistent polite tone.

## Learning records

Open **Statistics** (`#/stats`) without an editing password. It displays total study time, average time per study day, attempted questions, correct answers, accuracy, card flips, current streak, longest streak, and a seven-day study-time chart. All labels, duration units, dates, and instructions support English and Japanese and both themes.

- Records start with version 1.7.0 and remain in this browser. Ranking participants additionally publish the same day totals to D1. They are separate from D1 word sets and from clear-state records. Existing All first-pass clears are preserved. Word-set imports and exports do not contain learning records.
- Quizzes include thinking and feedback-reading time. Flashcards include reading time. Setup screens, results, Edit, Guide, Statistics, and all dialogs are excluded. Hidden pages and page-cache suspension stop time. Sixty seconds without a click, pointer press, keyboard action, input, or scroll pauses time; interaction resumes it.
- The average divides total time by the number of local calendar days with recorded time or an attempt/flip. Unstudied days are excluded. Zero activity shows zero time and a dash for accuracy.
- Answered, skipped, and timed-out questions each count once, including retries and questions in unfinished rounds. Late background timeouts belong to the deadline's local date. Both directions of a manual card flip count; navigation and automatic front-side resets do not.
- A streak day requires at least one attempted question or card flip. Before studying today, yesterday's continuing streak is shown. The longest streak includes all recorded days. Time-only reading days contribute to the daily average but do not start a streak.
- Time spans split at device-local midnight, and overlapping spans from multiple tabs are merged before summing. Each page writes its own cumulative record so simultaneous tabs cannot overwrite each other's counters. Records are saved after counted actions, screen transitions, page hiding, and once per second while open. An abrupt browser/process failure can lose the latest unsaved time slice.
- Clearing browser storage removes these records. If browser storage is unavailable or full, the Statistics page shows a notice and retains current-tab records in memory.

## Difficult words, favorites, and word search

Version 1.8.0 adds these views inside Practice. Main navigation is Practice / Statistics / Rankings / Guide, with Edit and Administration added for authenticated administrators. The browser document title follows the active main tab and selected UI language, including direct links and language changes while a dialog is open.

- **Difficult words:** select EN → JP or JP → EN and either one word set or a combined selection of sets. Each selection supports quizzes and flashcards. Two consecutive incorrect, skipped, or timed-out answers to the same question in the same direction register it. Three consecutive correct answers remove it. Regular word-set quizzes, difficult-word quizzes, favorite quizzes, and mistake retries all update the same question record. Other questions do not interrupt its streak. A miss resets the correct streak; a correct answer resets the miss streak. A registered question stays registered until its third consecutive correct answer. After recovery, two new consecutive misses register it again.
- **Favorites:** stars are available outside the flashcard flip button, in revealed quiz feedback, and in word search results/details. Save individual words and study them across sets or filter to one set. Recovery never removes favorites. Both quiz directions, question counts, card directions, and card orders are supported. A word can be in Favorites and Difficult words at the same time.
- **Word search:** partial matches search English words and Japanese meanings across all current sets, using the same case and NFKC normalization as quiz answers. Results show their source set, optional explanations in a detail dialog, and a star. Lists initially render 100 entries and can load more.
- **Identity and edits:** question streaks are separate by source set and direction. Japanese prompts with multiple valid English answers use one question record with the full accepted-answer list from their original set, including when only one synonym is favorited. Set renaming, note changes, and reordering preserve records. A changed English word, meaning, or accepted-answer group creates a new question identity. Favorites use the source set and normalized English word, so meaning/note changes preserve them; renaming the English word creates a different favorite identity. Deleted words are not shown.
- **Combined practice:** questions with the same prompt are merged within a round and retain their source references. Repeated English prompts combine their selected meanings into one correct answer, and other valid meanings of that English word are excluded from distractors. Answering a merged question updates all represented source question records. Distinct English words with one Japanese prompt are accepted as alternate answers. Repeated identical flashcards are also merged. Cards do not affect correct/miss streaks.
- **Small collections:** EN → JP quizzes obtain three distinct distractor meanings from each question’s original set first, including words outside the difficult/favorite selection, so a one-word collection can be quizzed. If the original set has too few distinct incorrect meanings, the remaining choices come from the complete library. If three distinct incorrect meanings cannot be provided for each question, multiple choice is unavailable; Japanese-to-English quizzes and flashcards remain available.
- **Progress and privacy:** these browser-local personal records do not require Edit authentication, are not shared in D1, and are not included in word-set JSON/ZIP exports. Counts, time, and flips still contribute to Statistics. Collection quizzes and their retries never award word-set clears; only an original word-set All round completed perfectly without retries can do so. Existing clear and statistics records are preserved. Streak tracking begins with this update; old individual answers were not recorded and cannot be reconstructed.

## Delete browser learning data

Settings includes a learning-data section above Administrator access. You can delete quiz completion status, difficult-word records (including success/failure streaks), favorites, or learning statistics separately, or delete all four categories together. Every choice opens a confirmation dialog that identifies the selected data and states that deletion cannot be undone. Cancel or Escape returns to Settings without deleting.

These actions delete this browser's selected learning data. Deleting Statistics or all learning data also resets private server statistics and published ranking records; offline removal is retried when connected. Shared D1 word sets, theme/language/sound preferences, and the administrator cookie are preserved. The controls are available without administrator authentication. Reset generations prevent other open tabs and pending in-memory writes from restoring deleted records. New study activity starts fresh records.

## Theme rendering and completion colors

Graphite uses the warm gold brand accent for selected navigation, practice tabs, segmented controls, question counts, card-order choices, and editor selections. Correct/incorrect feedback remains separate from selection styling. Dark brand icons use dark ink for contrast on the lighter accent. The page and app shell paint the active paper color explicitly. Modal backdrops use a neutral translucent black overlay with standard and WebKit blur declarations, avoiding a fixed green tint or inherited theme variables in the backdrop.

Completion indicators use theme-independent semantic colors: neutral gray for uncleared, orange for EN → JP, blue for JP → EN, and green for both. Light and dark modes use separate foreground/background/border colors. Both the book and the labeled status badge use these colors; labels and check/trophy icons also identify completion without relying on color. The Guide legend uses the same tokens.

## Rankings (version 1.9.0)

`#/rankings` offers all eight Statistics measures: total study time, average per study day, questions attempted, correct answers, accuracy, card flips, current streak, and longest streak. The server and Statistics use the same day-total summary function, and both views use the same number/time formatter. Accuracy requires at least 30 attempts; zero percent is eligible once the threshold is met. Other categories require a positive record. Boards show up to 100 rows, plus the current browser's own position outside the top 100. Equal raw values share a competition rank (1, 1, 3). Names can be duplicated; participant identity is separate.

On first visit, a bilingual name dialog appears from any tab. Choose Save and participate or Do not participate; closing that first dialog also declines. Display names allow 1–20 Unicode code points and do not require real names. Returning visitors keep their choice and can register or rename themselves from Rankings. Settings can stop or restart participation. Stopping hides the profile from public boards while retaining server records and continuing private statistics sync for administrators. Declining the first dialog also creates a private profile; if no name is entered, a stable automatic learner name is assigned. Settings can change a learner name without changing publication status. The first-visit dialog, Settings, Statistics, and Guide explain private sync in both interface languages. Anyone can read the boards.

A 256-bit random browser secret is retained in site storage, sent only to authenticated ranking endpoints as a bearer token, and represented in D1 by its SHA-256 identifier. It never grants editor access. Profiles and aggregate day totals are stored in the existing D1 database. Tables are created automatically by the existing bootstrap; no manual SQL migration or new secret is required. Changing a name updates the same profile. Clearing all site storage externally loses the browser identity; the in-app learning-data deletion controls preserve it. This feature does not merge different browsers or restore their local study history.

Uploads run about every 30 seconds while the app is open, at quiz completion, on transitions, and before loading Rankings. Small cached-revision uploads also use keepalive on page exit. Network failures retry on subsequent updates and on reconnect. Writes use revision checks and reset epochs to reject out-of-order uploads, synchronize across tabs, and prevent pre-reset records or in-flight uploads from undoing an opt-out. Offline publication changes and resets show a pending notice; the server applies them when the browser reconnects. Daily averages count only recorded study days. Streaks use each browser's IANA timezone; public current-streak boards also expire old streaks when the participant has not returned.

The API validates names, dates, timezones, counters, and time totals, checks origins, limits mutations to 120 per minute per client IP (or identity in local development), and never accepts an uploaded final ranking score directly. Measurements originate from the browser, so this is a casual learning leaderboard rather than a tamper-proof competition system. Public rows include only participant identifiers, display names, positions, and the selected aggregate measure; per-day records are not exposed by public APIs.

Validation includes real local D1 integration, agreement between all eight personal/public measures, the 29/30-question accuracy boundary, ties, own positions outside the top 100, identity ownership, rename/opt-out/rejoin, resets, delayed uploads across tabs, offline retries, and bilingual first-visit/UI flows.

## Native picker focus (version 1.9.1)

Only text-entry fields restore focus and caret position when their DOM nodes are replaced. Selects and buttons are never programmatically refocused during app rendering or modal closure. Committing any select blurs it during the capture phase before page or modal handlers run, with one animation-frame check for native picker focus restoration. Escape releases a canceled select; Enter can still open the native picker normally. Duplicate unchanged selection events do not resubmit ranking requests or repeat Settings updates. Text editing, search caret positions, and deliberate reopening of a menu remain available.

## Ranking moderation (version 1.10.0)

The authenticated navigation order is Practice / Statistics / Rankings / Guide / Edit / Administration. Settings uses the existing `ADMIN_PASSWORD` and session cookie to reveal both administrator tabs. Anonymous direct `#/admin` links return to Practice. Every `/api/admin/` operation is checked by the server before any participant or notice data is returned. Session expiry or exiting administrator mode hides both administrator tabs and clears loaded moderation rows.

Administration supports learner-name search and All learners / Listed / Not publicly listed / Removed filters, with 50 learners per page. All learners is the default and includes profiles with zero study activity. Listed includes enabled profiles even if they have not yet accumulated a qualifying ranking record. Removing a participant opens a confirmation form naming the target. Enter a Japanese message, an English message, or both, with at least one nonempty notice and a maximum of 500 Unicode code points per message. If only one is present, the participant sees that text in either interface language. Notices are rendered as plain text, including line breaks. They are visible only to the participant's browser identity and authenticated administrators.

Removal atomically disables public ranking participation, retains day totals and eight materialized metrics for administrators, increments the profile revision, and stores a private notice in the new `ranking_moderation` table. The existing bootstrap creates this table automatically without altering or resetting existing profiles or word sets. Participant identity, the removed name, the latest notice, and its acknowledgement state are retained so the browser can be notified. Each new removal generates a distinct notice identifier. Removed participants appear in the management filter until they rejoin.

On each visit and at periodic checks, previously registered browsers fetch their profile metadata even if they are no longer participating; opted-out and removed browsers continue uploading study data for administrators without becoming eligible for public boards. A pending notice appears on any tab after other open dialogs close. A participant can acknowledge it, or choose Review later to defer it until the next visit. Trying to register again during that visit reopens an unacknowledged notice. Acknowledgement is persisted on the server, so a confirmed notice does not reappear on later visits; a new removal produces a new notice. When offline, stored notices can still be read, but server acknowledgement waits until connectivity is available.

Rejoining requires server-confirmed acknowledgement of the current notice and an explicitly submitted name different from the removed name. Matching normalizes Unicode width, case, repeated whitespace, and common invisible zero-width characters. Old pending name edits, old acknowledgement identifiers, background statistics uploads, and older clients cannot silently undo a removal. An administrator's confirmed target name remains valid across routine statistics uploads, while a changed display name requires a new confirmation. Local study records, favorites, difficult words, clear progress, appearance preferences, and administrator access remain separate from ranking moderation. Rejoining republishes the browser's current local study totals under the same participant identity.

Browser identity still depends on the ranking secret retained in site storage. There is no cross-browser identity matching or permanent account ban. External removal of site data loses that identity; the in-app learning-data reset preserves it and the removal notice. Validation covers authenticated management, custom-language fallback, private message rendering, notification queuing, defer/revisit/acknowledgement, normalized-name rejection, renamed return, stale uploads, changed-target confirmation, and automatic database upgrade.

## Individual statistics for administrators (version 1.11.0)

Search a display name in Administration and select **View statistics**. The detail view shows all eight learning measures, the same seven-day chart, and a monthly calendar with daily records, using the same calculations and formatting as Statistics, including accuracy below 30 answers. Average time uses study days only. Current streaks are recalculated in the participant's timezone, so stale uploads do not preserve an expired streak. The participant timezone and last sync timestamp are shown. Return to participants preserves the search and status filter.

`GET /api/admin/rankings/:id/stats` requires the existing administrator session cookie; participant bearer tokens do not grant access. Responses use `Cache-Control: no-store`. Session expiry clears loaded private statistics and hides administrator navigation. Public rankings do not expose this detail endpoint or per-day records.

All profiles, including private and moderated profiles, expose their latest synced statistics only to authenticated administrators. Offline changes are unavailable until the learner reconnects. A private profile with no activity shows zero totals. Public ranking participation is independent of private statistics sync. No schema migration is required.

## Private study sync (version 1.12.0)

The existing `enabled` field now controls only public leaderboard inclusion. Every learner who completes or closes onboarding receives a browser secret and a server profile, including learners who decline public participation. A declined onboarding submission retains an entered learner name; a blank one receives `Learner <random suffix>`. Previously declined browsers without identities are upgraded to private profiles on their next visit. Existing identities and names are retained.

Private and moderated profiles use the same validated, revision-protected day-total upload API, 30-second updates, completion sync, reconnect retries, and small page-exit uploads as public profiles. Opting out and moderation no longer erase study totals. Moderation still blocks public rejoining until the notice is acknowledged and the removed display name changes. Editing a learner name in Settings preserves the publication choice and does not dismiss a removal notice. Public APIs filter by `enabled=1`, including requested self positions, so private profiles remain absent from all eight boards.

Administrators can search all registered learners, with All / Listed / Not publicly listed / Removed filters. Learner detail shows all eight synced measures whether or not the learner is listed. The same administrator cookie is required for list and detail APIs; bearer identities do not grant administrator access. Local reset controls still delete the corresponding local statistics and reset server totals for private as well as public profiles. Browser identity, name, publication preference, and notice acknowledgement are retained.

Existing server records erased by earlier versions cannot be recovered from D1. The updated client republishes the current browser-local totals privately on the next successful sync. Offline or never-returning browsers cannot be inspected until they connect. Browser storage still owns the identity; this is not cross-device account synchronization. No additional Cloudflare secrets, bindings, or manual database migrations are needed.

## One-word difficult quizzes and answer positions (version 1.13.0)

Difficult-word and favorite quizzes use the complete source word records as their choice bank, including words outside the practice selection. Every question prefers distractors from its own source set. Merged questions use the union of their source sets. Three distinct incorrect meanings are required; a small source set can fall back to the rest of the library. Alternate valid meanings of the same English prompt never become incorrect choices. Distractor words are not added to the quiz or counted as attempted questions.

All EN → JP rounds, including ordinary sets, collections, and mistake retries, assign correct positions so A–D frequencies differ by at most one. Extra positions in nonmultiples of four are chosen randomly, and the complete position sequence and distractor order are shuffled. There is no fixed A–B–C–D cycle. A one-question round still chooses its correct position randomly. Japanese-to-English input questions are unchanged.

## Import read isolation and content checks (version 1.13.1)

Every file selection is parsed into an isolated local batch. Only the latest selection can update the preview, selection, errors, or confirmation button. Obsolete results, obsolete errors, and reads completing after the dialog closes are ignored. This fixes asynchronous selection races; it does not establish the cause of every reported stale-content incident.

Import previews show the selected filename, including the member path inside ZIP files. Expand a set to inspect all words, meanings, and explanations before importing. Word details render only when expanded. Same-title sets trigger a warning because imports create separate copies, preserving the existing create-only policy. JSON spelling and Unicode are preserved except for existing leading/trailing whitespace validation.

The submitted batch is captured before posting. The server response is compared with the validated selection before success is displayed. Mismatched responses report a content error and prevent repeated submissions until the dialog is closed; the message explains that saving may already have completed and asks the administrator to reload before retrying. API requests explicitly bypass the browser cache. Regression tests cover asynchronous file selection, delete/reimport/reload, and JSON/ZIP/export round trips against real local D1.

## Administrator terminology (version 1.13.2)

Settings, session status, authentication messages, and the Guide use Administrator mode in English and its Japanese equivalent. Enabling the mode reveals both Edit and Administration; exiting it ends the shared administrator session. Authentication and permissions are unchanged.

## Flashcard bookmarks and study calendar (version 1.14.0)

Flashcard progress is saved automatically in this browser after starting a deck, moving, or turning a card. Selecting Flashcards shows **Resume flashcards** when a compatible bookmark exists. Resuming restores the direction, original/reverse/random order, exact random sequence, current card, and visible side. Restoring a side does not add a card flip. Starting a fresh deck replaces that context's bookmark. Ordinary sets, favorite-set selections, and difficult-word selections have separate bookmarks. Changes to words, meanings, explanations, registration order, or collection membership invalidate incompatible bookmarks; title changes preserve them. Up to 100 recently updated contexts are retained. A storage failure preserves current-tab progress and displays a warning. Bookmarks are local to the browser and are not included in word-set exports or server statistics. Deleting all learning data clears bookmarks, including pending writes from other tabs; deleting statistics alone preserves them.

Statistics now includes a monthly calendar below the seven-day chart. Cells use fixed study-time intensity bands: activity under five minutes, five to under fifteen, fifteen to under thirty, and thirty minutes or more. An attempt or flip with no recorded time still marks an active date. Select a date to inspect time, attempted questions, correct answers, accuracy, and flips. Zero attempts show an em dash for accuracy. A colored date can contain reading time only; the existing streak rule still requires an attempt or flip. Month navigation spans the first recorded month through the current month, with future dates disabled. All dates use device-local calendar days, and all six palettes use the same theme-aware intensity scale. Existing learning history appears immediately; no database migration is required. English and Japanese interface text and the Guide cover both additions.

## Administrator action alignment (version 1.14.1)

Participant actions use consistent columns for View statistics and the removal button or publication-status label, so all rows align regardless of status. Narrow screens move both actions below the participant details. Settings no longer includes an Open editor shortcut; Edit remains available through navigation after administrator authentication.

## Shared administrator study history (version 1.15.0)

Administrator learner details now reuse the personal Statistics chart and calendar components. The authenticated detail API returns validated day totals and the learner's current calendar date alongside the existing summary. Both the seven-day chart and calendar use that learner's timezone; viewing from another timezone does not move their recorded dates. Private and removed learners remain accessible only with an administrator session. Public ranking APIs and their privacy rules are unchanged.

Personal and administrator calendar selections are independent. Refreshing a learner's history preserves its selected month/date when valid; opening a different learner resets the administrator selection. No-history profiles show seven zero-day bars and an empty current-month calendar. Session expiry clears loaded learner details. The calendar's Today shortcut and its Guide references have been removed in both languages; month navigation remains. No database migration is needed.

## Compact editor guidance (version 1.15.1)

When no word set is selected, the editor displays a compact, top-aligned 12px guidance note with modest padding. It no longer stretches the general empty-state panel to match the word-set list height. English and Japanese guidance and editor actions are unchanged.

## Set-first editor selection (version 1.15.2)

Before a set is selected, the editor displays a muted, borderless note under its heading using the Statistics note style. The set picker fills the available width with larger responsive cards rather than reserving most of the page for guidance. Selecting or creating a set returns to the existing editor layout.

## Flashcard pronunciation (version 1.16.0)

English faces of flashcards include a speaker button next to the word. Playback uses the browser's Web Speech synthesis API without a new server endpoint or API key. It applies to ordinary sets, Favorites, and Difficult words. In JP → EN, pronunciation becomes available only after the English answer is revealed; hidden-face controls are disabled and removed from keyboard navigation. Browsers without synthesis support retain normal flashcards without the speaker control.

The button speaks immediately within the click gesture, retains its utterance until completion, and checks the current voice list on each click. It prefers an available US English voice, then another English voice, with an en-US language request when no voice has loaded yet. Actual voices and playback behavior depend on the browser and device. Grouped Japanese prompts read their accepted English answers separated by pauses. Tapping again replaces the previous utterance rather than queueing it. Moving, flipping, rerendering, opening a dialog, navigating, hiding, or leaving the page stops owned speech. Pronunciation works independently of quiz sound effects and never increments flip counts or changes the card side. Errors are localized and restore the button state.

The flip area and pronunciation are separate native buttons, with no nested buttons. Speaker taps and keyboard activation do not trigger flips or swipes. The existing card height behavior, long meanings, swipe gestures, favorites, bookmarks, and keyboard shortcuts remain available. Regression tests mock synthesis to verify request timing, language selection, delayed voice availability, repeated taps, cleanup, errors, hidden answers, unsupported browsers, and unchanged learning counts.

## Flashcard face taps (version 1.16.1)

Pointer taps on the visible word, label, card face, or unused card space now flip the card through delegated card handling. The former full-card transparent button beneath a pointer-disabled 3D layer has been replaced with an explicit, visible hint button. The card faces receive pointer events directly, and inactive faces reject them. Speaker buttons still invoke pronunciation independently. The same swipe-click suppression protects both card-body taps and the hint button, preserving keyboard controls, speech cleanup, and accurate flip counts. A regression test exercises the actual visible text and face targets in both directions rather than clicking only the flip action programmatically.

## Optional IPA and theme-colored cards (version 1.17.0)

Each word has an optional **Pronunciation (IPA)** field in Edit. Its symbol palette appears only while that input has focus. Tapping a symbol inserts it at the cursor or replaces the selection, keeping the input focused; typing and pasting also work. The field accepts up to 200 characters without line breaks or control characters. Matching pasted square brackets or slashes are stripped on save/import; flashcards consistently display square brackets, such as `[əˈtʃiːv]`.

IPA appears below the English word, including on the revealed English side in JP → EN. Grouped collection cards can show each source word's notation. IPA is display data and does not change the speech synthesis request. Empty fields remain absent from exports, so existing sets and JSON files work unchanged. Nonempty IPA is saved in D1 and included in JSON/ZIP import/export and import previews. Updating only IPA preserves clears, difficult-word streaks, favorites, and flashcard bookmarks. No database migration or new service is required.

Flashcard backs use the selected theme's accent color in all six palettes. Word, IPA, label, and flip-hint foreground colors are chosen for readable contrast. Automated coverage includes palette focus and caret insertion, real D1 persistence and transfers, both card directions, unchanged learning progress, and all six back-face color combinations.

## Long-press pronunciation variants (version 1.17.1)

Vowel keys with a small corner mark support an iOS-style long press. Hold for about 0.4 seconds to show variants such as `ǽ`, `æ̀`, `æ̂`, `ǣ`, `æ̆`, `æ̃`, and `æ̈`, alongside the base letter. This works for the IPA vowels and the added `a`, `e`, `i`, `o`, and `u` keys. A short tap still inserts the base character. Slide onto a candidate and release to select it, or release over the original key and then tap a candidate. On desktop, right-clicking a marked key also opens its alternatives.

The input keeps its focus, cursor/selection, and mobile keyboard during selection. Variants use Unicode combining marks and survive D1 saves, JSON/ZIP transfers, and bracketed flashcard display without replacing them with standalone apostrophes. The 200-character limit counts the entire sequence. Candidate placement respects the visual viewport so it can stay above the on-screen keyboard. Escape, pointer cancellation, scrolling, focus loss, dialogs, navigation, and viewport changes dismiss pending selection; a completed hold never also types the original key. Regular page scrolling remains available outside the keys.

Automated tests use simulated pointer capture and hit testing to cover both selection styles, short taps, cursor replacement, duplicate-click suppression, interruption cleanup, viewport boundaries, and persistence of combining accents. Physical iOS/iPadOS device testing has not been performed.

## Subtle card tint and expanded pronunciation palette (version 1.18.0)

Flashcard backs now mix 10% of the current accent into the normal card surface, with a softly accented border and the theme's normal text color. This replaces the solid accent fill. The tint follows all six palettes, including changes made while a modal is open; text and flip hints retain readable contrast.

Pronunciation text uses the bundled **Charis 7.000 italic** serif face on cards, in the editor, on symbol keys and long-press candidates, and in import previews. The font supports IPA and combining accents; both regular and italic WOFF2 faces are shipped with their SIL Open Font License. Files are served locally, including on iOS/iPadOS, with no external font service or installation required. See `public/assets/fonts/README.txt` for provenance.

The focus-only palette now has five localized categories, with 144 distinct keys and 354 directly selectable forms when long-press alternatives are counted:

- **Vowels:** all base vowels needed for the checked UK/US dictionary tables, rhotic `ɚ / ɝ`, the visually similar `ə / ɘ / ɜ / ɐ`, central vowels, and additional regional/loanword notation.
- **Consonants:** the full basic English consonant inventory, including ordinary letters, `θ / ð / ʃ / ʒ / ŋ`, `tʃ / dʒ`, and both `r / ɹ` conventions.
- **Combinations:** long vowels, UK/US diphthongs such as `əʊ / oʊ`, centering diphthongs, and common r-combinations.
- **Detailed notation:** `ɾ / ʔ / ɫ / ʍ / x / ç`, other regional realizations, syllabic consonants, tied and legacy affricates, and superscript forms.
- **Marks:** primary/secondary stress, length, syllable/word linking, optional-sound parentheses, and combining marks for accents, nasalization, syllabicity, voicing, place, and release. A dotted circle only previews the attachment point; it is never inserted into saved IPA.

Category changes retain the active field and its selection. Common stress/length keys remain available below the first four categories. Long-press alternatives are supported for every vowel. There is no automatic conversion between dictionary conventions: existing IPA strings remain intact, and ordinary Unicode typing/paste still accepts notation beyond the palette.

The base inventory and phonetic-detail coverage were checked against [Oxford's English pronunciation guide](https://www.oxfordlearnersdictionaries.com/about/english/pronunciation_english) and [Charles University's English transcription reference](https://fonetika.ff.cuni.cz/o-fonetice/foneticka-transkripce/ipa-transcription-english/). The two sources distinguish dictionary-level symbols from narrower phonetic details; the palette offers both. English accents and dictionary conventions vary, so the key count includes alternative spellings and combinations rather than counting English phonemes.

Verification includes category/caret interaction, the checked dictionary inventory, correct insertion of combining marks without dotted circles, D1 persistence, existing long-press and card behavior, and contrast of the softened back in every palette. Both bundled font faces match the official release, and their corresponding character maps cover every code point used by the palette and its variants. No database migration is needed.
