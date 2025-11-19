# Arte Subtitle Translator Extension · Technical Spec

## 0. Goal

Build a cross-browser (Chrome + Firefox, MV3) browser extension that:

- Detects **subtitles** on Arte.tv videos.
- Downloads the corresponding `.vtt` subtitle file.
- Translates the subtitle text to **English** via a configurable translation backend.
- Injects a **new subtitle track** into the video player so Arte’s own UI shows an extra “English (translated)” track.

---

## 1. High-level Architecture

Components:

1. **Manifest (MV3)**  
   Describes permissions, background service worker, content scripts, and options page.

2. **Content script**  
   Runs on Arte.tv video pages. Detects the video and the French subtitle track; sends a request to the background script; injects a new English track once translation is ready.

3. **Background service worker**  
   Orchestrates the heavy work:
   - Fetch `.vtt`
   - Parse cues
   - Call translation backend
   - Rebuild translated `.vtt`
   - Return the result to the content script

4. **VTT utilities module**  
   Pure functions to parse WebVTT into structured data and rebuild it back into valid VTT text.

5. **Translation adapter module**  
   Abstracts whatever translation API is used. One implementation for MVP. Configurable via options.

6. **Options page**  
   Simple UI for configuring translation provider, API key, model, etc.

---

## 2. Project Setup Tasks

### 2.1 Project structure

- [x] Create basic project folders, for example:
  - `src/` for source files (background, content script, utilities, options logic)
  - `public/` for static assets such as `options.html` and icons
  - `manifest.json`
- [x] Use Vite
- [x] Configure build so that:
  - Source files are built into `dist/`
  - `manifest.json` and static assets are copied into `dist/`

### 2.2 Tooling

- [x] Use TypeScript.
- [x] Set up linting and formatting.
- [x] Add `npm` scripts:
  - `build` for a production bundle
  - `dev` or `watch` for rapid local testing (if supported by bundler)

---

## 3. Manifest Definition Tasks

### 3.1 Basic fields

- [x] Set `manifest_version` to `3`.
- [x] Define `name`, `version`, and `description`.
- [x] Specify a background service worker file under `background.service_worker`.
- [x] Declare a content script entry under `content_scripts` that:
  - Matches `https://www.arte.tv/*`
  - Points to the built content script file
  - Uses `run_at: "document_idle"` (or similar)

### 3.2 Permissions

- [x] Grant `"permissions"` for:
  - `storage`
  - Any other required generic permission such as `scripting` if needed
- [x] Grant `"host_permissions"` for:
  - `https://www.arte.tv/*`
  - Arte subtitle CDN domains, such as `https://arte-cmafhls.akamaized.net/*`
    (and any additional variants actually observed)

### 3.3 Options UI

- [x] Add an `options_ui` section:
  - `page`: path to `options.html`
  - `open_in_tab`: `true`

- [x] Ensure the manifest is accepted both by Chrome and Firefox MV3 validators.

---

## 4. Content Script Tasks

### 4.1 Detect the video element

- [x] Implement logic to find the main `<video>` element on the page:
  - First attempt: direct `querySelector`.
  - Fallback: `MutationObserver` on `document.documentElement` to detect dynamically inserted `<video>` elements.
  - Apply a timeout to avoid watching forever if no video appears.

### 4.2 Find the French subtitle track

- [x] Once the `<video>` is found, search its child `<track>` elements where:
  - `kind` is `"subtitles"` or `"captions"`.
  - `srclang` equals `"fr"` **or** the `label` text contains `"fr"` (case insensitive).
- [x] If no French track is found within a timeout, log and stop further processing.

### 4.3 Request translation from background

- [ ] When a French track with a valid `src` URL is found:
  - Prepare a message object including:
    - Message type, e.g. `"TRANSLATE_VTT"`
    - Subtitle URL (`track.src`)
    - Source language (`"fr"`)
    - Target language (`"en"`)
  - Send the message to the background worker via the browser runtime messaging API.
  - Await a response that either:
    - Contains the translated VTT text, or
    - Indicates an error.

### 4.4 Inject the translated track

- [x] Upon a successful response:
  - Create a `Blob` from the returned VTT text, using `text/vtt` as MIME type.
  - Create an object URL from the blob.
- [x] Create a new `<track>` element:
  - Start from the original French track’s attributes or clone it.
  - Override:
    - `src` with the blob URL
    - `srclang` to `"en"`
    - `label` to something like `"English (translated)"`
    - Optionally set `default` to `true` so the translated track is selected by default.
- [x] Append the new track element to the `<video>` element so the Arte player exposes it in the subtitle menu.
- [x] Log a debug message indicating success.

### 4.5 Avoid duplicates and handle dynamic changes

- [x] Ensure the content script does not inject multiple English tracks for the same video:
  - Before injecting, check for an existing track with `srclang="en"` and a known label pattern.
- [x] If Arte replaces the `<video>` when switching episodes:
  - Use the `MutationObserver` to detect new `<video>` elements.
  - Repeat detection and injection for the new player instance.
  - Avoid re-processing old or removed players.

---

## 5. Background Service Worker Tasks

### 5.1 Message handling

- [x] Register a listener for incoming runtime messages.
- [x] Filter on the specific translation request type.
- [x] Validate input:
  - Ensure subtitle URL and language parameters exist.
- [x] For valid requests, run the pipeline:
  1. Fetch the VTT file.
  2. Parse it into cues.
  3. Translate cue texts.
  4. Rebuild the VTT.
  5. Return the translated VTT text to the sender.

### 5.2 Fetch the `.vtt` file

- [x] Use `fetch` to retrieve the subtitle file.
- [x] Handle:
  - HTTP errors (non-2xx status).
  - Network errors.
- [x] Read the body as plain text on success.

### 5.3 Parse the VTT

- [x] Use the VTT utility module to parse the VTT text into an array of cue objects.
- [x] Each cue should contain:
  - Optional identifier
  - Start time string
  - End time string
  - Optional settings string (anything after the end time on the cue time line)
  - Text content (may span multiple lines)

### 5.4 Translate cue texts

- [x] Extract `text` from each cue in order.
- [x] Pass the array of texts to the translation adapter along with source and target language codes.
- [x] Receive back an array of translated strings of the same length.
- [x] Replace each cue’s `text` with the translated text in order.

### 5.5 Rebuild the VTT

- [x] Use the VTT utility module to turn the translated cues back into a proper `.vtt` file:
  - Include the `WEBVTT` header.
  - Preserve IDs, timings, and settings.
  - Insert a blank line between cue blocks.
- [x] Return the VTT string in the background’s response.

### 5.6 Error handling

- [x] Wrap the full pipeline in error handling.
- [x] On failure:
  - Log a clear, concise message with basic context.
  - Avoid throwing unhandled exceptions; respond with an error object or rejected promise that the content script can detect.
- [x] Ensure user experience on Arte remains unaffected when translation fails.

---

## 6. VTT Utility Module Tasks

### 6.1 Parsing VTT

- [x] Implement a function that:
  - Accepts a WebVTT string.
  - Ignores the `WEBVTT` header and any leading metadata lines.
  - Iterates over cue blocks:
    - Optional ID line (non-empty, without the `"-->"` marker).
    - Time line with the `start --> end` pattern, followed by optional settings.
    - One or more text lines until a blank line.
  - Produces an array of cue objects with:
    - `id` (optional)
    - `start`
    - `end`
    - `settings` (optional)
    - `text` (text lines joined by newline characters).

- [x] Be tolerant of:
  - Extra blank lines.
  - Slightly malformed sections (skip gracefully rather than crashing).

### 6.2 Building VTT

- [x] Implement a function that:
  - Accepts an array of cue objects.
  - Produces a valid WebVTT string:
    - Header line `WEBVTT`.
    - Blank line after header.
    - For each cue:
      - Optional line with `id` if present.
      - Line with `start --> end` and optional settings.
      - One or more lines containing the cue text (split on newline characters).
      - Blank line after each cue.

### 6.3 Testing and robustness

- [x] Add simple unit-style checks (even ad hoc) to verify:
  - Round-trip parsing and building of a known VTT sample yields the same content (ignoring harmless whitespace differences).
  - Multi-line texts and basic inline tags survive round-trip.

---

## 7. Translation Adapter Module Tasks

### 7.1 Configuration storage

- [x] Read and write configuration via extension storage:
  - Provider type (e.g. a string identifier).
  - API base URL (if applicable).
  - API key or token.
  - Model or mode selection.

### 7.2 Adapter interface

- [x] Expose a single entry point, conceptually:
  - Input:
    - Array of original texts in order.
    - Source language code.
    - Target language code.
  - Output:
    - Promise that resolves to an array of translated texts of the same length and in the same order.

- [x] Implement translation using a single provider for MVP:
  - Construct requests according to provider’s API.
  - Optionally batch texts to respect input size limits.
  - Preserve the mapping between original indexes and responses.

- [x] Handle mismatches:
  - If provider output does not match expected number of segments, either:
    - Fail gracefully, or
    - Apply a documented fallback strategy.

- [x] Do not log raw subtitle text in normal operation.
- [x] Log only:
  - Provider HTTP status codes.
  - Error messages.
  - High-level events (e.g. “translation started / completed”).

---

## 8. Options Page Tasks

### 8.1 UI design

- [x] Create `options.html` with:
  - Form fields for:
    - Provider selection (dropdown or text).
    - API base URL (if relevant).
    - API key (password-type input).
    - Model name or translation mode.
  - A “Save” button.
  - An area for success/error messages.

### 8.2 Options logic

- [x] On page load:
  - Retrieve configuration from extension storage.
  - Populate form fields with current values.
- [x] On “Save”:
  - Validate required fields.
  - Write updated configuration to storage.
  - Show a short “Saved” confirmation message.

---

## 9. Permissions, Storage and Compatibility

- [x] Use the `browser` namespace where available, with a thin wrapper for Chrome’s `chrome` namespace if necessary, to keep one codebase.
- [x] Store configuration in `storage.sync` if supported; otherwise fall back to `storage.local`.
- [x] Ensure:
  - All network requests to Arte’s CDN domains are permitted by host permissions.
  - All requests to the translation provider are allowed by the extension’s permissions and by CORS rules.

---

## 10. Testing Tasks

### 10.1 Manual testing on Arte.tv

- [ ] Install the extension as an unpacked/temporary add-on.
- [ ] Open an Arte.tv video known to have French subtitles.
- [ ] Check the subtitle menu before the extension acts:
  - Note existing audio and subtitle options.
- [ ] With the extension enabled:
  - Wait briefly for the content script to run.
  - Reopen the subtitle menu.
  - Verify that a new subtitle option appears (e.g. “English (translated)”).
  - Select this option and confirm that subtitles differ from the original French track in a clear way (for early testing, a simple text marker is acceptable).
- [ ] Confirm:
  - No visible impact on video playback if translation fails.
  - No console errors in normal scenarios.

### 10.2 Edge and failure cases

- [ ] Test a video with no French subtitles:
  - Confirm that the extension does not inject anything and fails quietly.
- [ ] Test when:
  - API key is missing.
  - Translation provider is unreachable.
  - Provider returns an error.
- [ ] Verify:
  - The content script logs an understandable error.
  - Arte’s player behaves normally.

### 10.3 Episode / navigation behaviour

- [ ] On Arte, switch to another episode or video without refreshing the page:
  - Confirm that the extension detects the new `<video>` and injects subtitles again.
  - Confirm that it does not create duplicate English tracks for the same video.

---

## 11. Packaging Tasks

- [x] Ensure `dist/` contains all necessary files:
  - Built background script
  - Built content script
  - VTT utilities
  - Translation adapter
  - Options page assets
  - `manifest.json`
- [x] Test loading:
  - In Chrome: “Load unpacked” pointing at `dist/`.
  - In Firefox: “Load temporary add-on”.
- [x] Optionally:
  - Add a build step that packages `dist/` as a `.zip` for store uploads.
