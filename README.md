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

Settings contains no word-set management actions. Its bottom Administrator access section accepts the existing `ADMIN_PASSWORD`, reveals Edit after successful server authentication, and offers Open editor and Lock editor while authenticated. There is no password wall on the Edit page; anonymous `#/edit` links return to Practice. After enabling editing, the toolbar contains **New set**, **Import**, **Export**, and **Manage sets**. Lock editor is available only in Settings.

Practice cards contain no export checkboxes or New set buttons. The editor provides creation and backup actions directly; they remain hidden while the editor is locked. Focus outlines and focus shadows are suppressed throughout the interface, including modal headings and buttons. Direction cards have no sticky hover highlight, and pointer clicks do not leave the selected button focused.

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

- Enable editing with the administrator password at the bottom of Settings. Authentication reveals the Edit tab and the editing guide; locking or an expired-session response hides both. Unsaved drafts remain in memory after session expiry and can be resumed after authenticating again.
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

## Delete and reorder word sets

Enable editing in **Settings**, open **Edit**, then open **Manage sets**.

- Use the up/down buttons to change the display order, then choose **Save order**. The saved order applies to the Practice page, Edit list, and export picker on every browser after loading the current collection.
- Saving a word's content does not move its set. New sets and imported sets are added above the existing collection.
- Closing with an unsaved order asks whether to discard that order. Saving keeps the management dialog open.
- The trash button opens a confirmation. Confirming deletes the set immediately, independently of saving the display order. Cancelling an order change does not restore sets already deleted.
- Deleting the currently edited set also discards that set's draft, with a warning when it has unsaved edits. Drafts for other sets are preserved.
- The server validates the complete set list and checks the collection revision. A stale reordering request cannot silently overwrite changes from another browser.
- Existing installations automatically get a persistent display order based on their previous visible order. No manual migration is required.

Delete sets through **Edit → Manage sets** after unlocking the editor.

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
- **Small collections:** EN → JP quizzes can obtain three distinct distractor meanings from the complete word-set library, so a one-word favorite or difficult list can still be quizzed. If three distinct incorrect meanings cannot be provided for each question, multiple choice is unavailable; Japanese-to-English quizzes and flashcards remain available.
- **Progress and privacy:** these browser-local personal records do not require Edit authentication, are not shared in D1, and are not included in word-set JSON/ZIP exports. Counts, time, and flips still contribute to Statistics. Collection quizzes and their retries never award word-set clears; only an original word-set All round completed perfectly without retries can do so. Existing clear and statistics records are preserved. Streak tracking begins with this update; old individual answers were not recorded and cannot be reconstructed.

## Delete browser learning data

Settings includes a learning-data section above Administrator access. You can delete quiz completion status, difficult-word records (including success/failure streaks), favorites, or learning statistics separately, or delete all four categories together. Every choice opens a confirmation dialog that identifies the selected data and states that deletion cannot be undone. Cancel or Escape returns to Settings without deleting.

These actions delete this browser's selected learning data. Deleting Statistics or all learning data also resets the published ranking records; offline removal is retried when connected. Shared D1 word sets, theme/language/sound preferences, and the administrator cookie are preserved. The controls are available without administrator authentication. Reset generations prevent other open tabs and pending in-memory writes from restoring deleted records. New study activity starts fresh records.

## Theme rendering and completion colors

Graphite uses the warm gold brand accent for selected navigation, practice tabs, segmented controls, question counts, card-order choices, and editor selections. Correct/incorrect feedback remains separate from selection styling. Dark brand icons use dark ink for contrast on the lighter accent. The page and app shell paint the active paper color explicitly. Modal backdrops use a neutral translucent black overlay with standard and WebKit blur declarations, avoiding a fixed green tint or inherited theme variables in the backdrop.

Completion indicators use theme-independent semantic colors: neutral gray for uncleared, orange for EN → JP, blue for JP → EN, and green for both. Light and dark modes use separate foreground/background/border colors. Both the book and the labeled status badge use these colors; labels and check/trophy icons also identify completion without relying on color. The Guide legend uses the same tokens.

## Rankings (version 1.9.0)

`#/rankings` offers all eight Statistics measures: total study time, average per study day, questions attempted, correct answers, accuracy, card flips, current streak, and longest streak. The server and Statistics use the same day-total summary function, and both views use the same number/time formatter. Accuracy requires at least 30 attempts; zero percent is eligible once the threshold is met. Other categories require a positive record. Boards show up to 100 rows, plus the current browser's own position outside the top 100. Equal raw values share a competition rank (1, 1, 3). Names can be duplicated; participant identity is separate.

On first visit, a bilingual name dialog appears from any tab. Choose Save and participate or Do not participate; closing that first dialog also declines. Display names allow 1–20 Unicode code points and do not require real names. Returning visitors keep their choice and can register or rename themselves from Rankings. Settings can stop or restart participation. Stopping removes the stored published totals and prevents subsequent statistics uploads while retaining local learning records. No statistics or identity requests are sent for a browser that has declined without ever registering. Anyone can read the boards.

A 256-bit random browser secret is retained in site storage, sent only to authenticated ranking endpoints as a bearer token, and represented in D1 by its SHA-256 identifier. It never grants editor access. Profiles and aggregate day totals are stored in the existing D1 database. Tables are created automatically by the existing bootstrap; no manual SQL migration or new secret is required. Changing a name updates the same profile. Clearing all site storage externally loses the browser identity; the in-app learning-data deletion controls preserve it. This feature does not merge different browsers or restore their local study history.

Uploads run about every 30 seconds while the app is open, at quiz completion, on transitions, and before loading Rankings. Small cached-revision uploads also use keepalive on page exit. Network failures retry on subsequent updates and on reconnect. Writes use revision checks and reset epochs to reject out-of-order uploads, synchronize across tabs, and prevent pre-reset records or in-flight uploads from undoing an opt-out. Offline opt-outs and resets show a pending notice; published records remain until the server receives the change. Daily averages count only recorded study days. Streaks use each browser's IANA timezone; public current-streak boards also expire old streaks when the participant has not returned.

The API validates names, dates, timezones, counters, and time totals, checks origins, limits mutations to 120 per minute per client IP (or identity in local development), and never accepts an uploaded final ranking score directly. Measurements originate from the browser, so this is a casual learning leaderboard rather than a tamper-proof competition system. Public rows include only participant identifiers, display names, positions, and the selected aggregate measure; per-day records are not exposed by public APIs.

Validation includes real local D1 integration, agreement between all eight personal/public measures, the 29/30-question accuracy boundary, ties, own positions outside the top 100, identity ownership, rename/opt-out/rejoin, resets, delayed uploads across tabs, offline retries, and bilingual first-visit/UI flows.

## Native picker focus (version 1.9.1)

Only text-entry fields restore focus and caret position when their DOM nodes are replaced. Selects and buttons are never programmatically refocused during app rendering or modal closure. Committing any select blurs it during the capture phase before page or modal handlers run, with one animation-frame check for native picker focus restoration. Escape releases a canceled select; Enter can still open the native picker normally. Duplicate unchanged selection events do not resubmit ranking requests or repeat Settings updates. Text editing, search caret positions, and deliberate reopening of a menu remain available.

## Ranking moderation (version 1.10.0)

The authenticated navigation order is Practice / Statistics / Rankings / Guide / Edit / Administration. Settings uses the existing `ADMIN_PASSWORD` and session cookie to reveal both administrator tabs. Anonymous direct `#/admin` links return to Practice. Every `/api/admin/` operation is checked by the server before any participant or notice data is returned. Session expiry or locking hides both administrator tabs and clears loaded moderation rows.

Administration supports name search and Listed / Removed filters, with 50 participants per page. Listed includes enabled profiles even if they have not yet accumulated a qualifying ranking record. Removing a participant opens a confirmation form naming the target. Enter a Japanese message, an English message, or both, with at least one nonempty notice and a maximum of 500 Unicode code points per message. If only one is present, the participant sees that text in either interface language. Notices are rendered as plain text, including line breaks. They are visible only to the participant's browser identity and authenticated administrators.

Removal atomically disables the profile, deletes all published day totals and eight materialized metrics, increments the profile revision, and stores a private notice in the new `ranking_moderation` table. The existing bootstrap creates this table automatically without altering or resetting existing profiles or word sets. Participant identity, the removed name, the latest notice, and its acknowledgement state are retained so the browser can be notified. Each new removal generates a distinct notice identifier. Removed participants appear in the management filter until they rejoin.

On each visit and at periodic checks, previously registered browsers fetch their profile metadata even if they are no longer participating; opted-out or removed browsers do not upload study data. A pending notice appears on any tab after other open dialogs close. A participant can acknowledge it, or choose Review later to defer it until the next visit. Trying to register again during that visit reopens an unacknowledged notice. Acknowledgement is persisted on the server, so a confirmed notice does not reappear on later visits; a new removal produces a new notice. When offline, stored notices can still be read, but server acknowledgement waits until connectivity is available.

Rejoining requires server-confirmed acknowledgement of the current notice and an explicitly submitted name different from the removed name. Matching normalizes Unicode width, case, repeated whitespace, and common invisible zero-width characters. Old pending name edits, old acknowledgement identifiers, background statistics uploads, and older clients cannot silently undo a removal. An administrator's confirmed target name remains valid across routine statistics uploads, while a changed display name requires a new confirmation. Local study records, favorites, difficult words, clear progress, appearance preferences, and administrator access remain separate from ranking moderation. Rejoining republishes the browser's current local study totals under the same participant identity.

Browser identity still depends on the ranking secret retained in site storage. There is no cross-browser identity matching or permanent account ban. External removal of site data loses that identity; the in-app learning-data reset preserves it and the removal notice. Validation covers authenticated management, custom-language fallback, private message rendering, notification queuing, defer/revisit/acknowledgement, normalized-name rejection, renamed return, stale uploads, changed-target confirmation, and automatic database upgrade.
