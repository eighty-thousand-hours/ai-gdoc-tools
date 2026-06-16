# 80,000 Hours Google Docs add-on

Google Docs add-on for 80,000 Hours editorial work. Provides style checking, link tools, fact-checking, and export utilities via sidebar UIs.

## What it does

Seven tools, all accessible from the **80k Editorial Tools** menu in any Google Doc:

- **Check against style & shortcode guide** — Scans the document against the 80k style guide. ~97 deterministic rules covering glossary, formatting, and math, plus LLM-powered suggestions for tone, hedging, clarity, voice, precision, and structure.
- **Test and fact-check links** — Verifies that each external hyperlink in the document actually supports the claim in the surrounding sentence. Fetches the target page, asks Claude to compare, and groups results by status: OK / needs attention / couldn't verify (paywalls, anti-bot, government pages).
- **Archive external links** — Replaces every external link with its latest Wayback Machine snapshot. If no snapshot exists yet, automatically triggers Save Page Now and uses the freshly-created snapshot. Internal 80k links and existing archive.org links are left unchanged. A debug panel lets you bulk-revert archived links back to originals.
- **Suggest internal links** — Sends document text and the 80k site catalog to Claude, which suggests inline links to relevant 80k publications.
- **Prepare for WordPress** — Converts the active doc to Markdown in a new tab, uploading all images to the WordPress media library. Handles headings, bold/italic/strikethrough, hyperlinks, nested lists, tables, horizontal rules, footnotes (as `[fn N]…[/fn]` shortcodes), and image+italic-caption pairs (as `<figure>` HTML).
- **Flag stale claims** — Uses Claude's web-search tool with extended thinking to check whether any claims in the document may have been contradicted or updated recently. Each finding includes a "Why flagged" reasoning.
- **Prepare for Substack** — Creates a new tab with content reformatted for pasting into a Substack draft. Converts footnotes to `[fn:N]` markers and adds metadata for the 80k Substack Helper Chrome extension.

## Files

| File | Description |
|---|---|
| `Code.gs` | Entry point: menu registration, document reading, fix/link application |
| `StyleRules.gs` | Deterministic rule engine (~65 glossary, ~24 formatting, ~8 math rules) |
| `ClaudeAPI.gs` | LLM integration (Anthropic): style check, link suggestions, related work, link verification, recency check |
| `Catalog.gs` | 80k site catalog (auto-generated from `full-catalog.json` in internal-linking-automation) |
| `ResearchHelper.gs` | External-link enumeration, URL fetching + HTML stripping, recency-check driver (backs "Test and fact-check links" and "Flag stale claims") |
| `LinkArchiver.gs` | Wayback Machine lookup, Save Page Now triggering, and un-archive logic |
| `MarkdownExport.gs` | Doc-to-Markdown conversion, WordPress image upload, new-tab creation |
| `SubstackTab.gs` | Substack-copyable tab creation, footnote-to-marker conversion, metadata block |
| `Sidebar.html` | Style checker sidebar UI |
| `LinksSidebar.html` | Internal links + related articles sidebar UI |
| `ResearchSidebar.html` | Sidebar UI for "Test and fact-check links" and "Flag stale claims" (two tabs) |
| `LinkArchiverSidebar.html` | Archive external links sidebar UI |
| `MarkdownSidebar.html` | WordPress export sidebar UI |
| `appsscript.json` | Apps Script manifest and OAuth scopes |

## Setup

Deployed as an internal Google Workspace Marketplace add-on via [`clasp`](https://github.com/google/clasp). There is a single live Apps Script project (container-bound to a host Doc); its `scriptId` is committed in `.clasp.json` (the id is not a secret — auth is separate, via `clasp login` → `~/.clasprc.json`).

```bash
npm install -g @google/clasp
clasp login
clasp push --force            # upload code to the live script
```

`.claspignore` keeps non-add-on files (`docs/`, `README.md`, clasp templates) out of the push.

### Publishing an update to the whole org

```bash
clasp push --force                                   # 1. upload the latest code
clasp create-version "what changed"                  # 2. cut an immutable version (note the number printed)
clasp update-deployment -V <version> -d "<desc>" \
  YOUR_APPS_SCRIPT_DEPLOYMENT_ID   # 3. point the Marketplace deployment at it
```

**Steps 1–3 do NOT reach users on their own.** You must then, in the Google Cloud Console (GCP project `YOUR_GCP_PROJECT`):

4. **App Configuration** — set the **`Docs add-on script version`** field to the new version number:
   <https://console.cloud.google.com/apis/api/appsmarket-component.googleapis.com/googleapps_sdk?project=YOUR_GCP_PROJECT>
5. **Store Listing → Publish**:
   <https://console.cloud.google.com/apis/api/appsmarket-component.googleapis.com/googleapps_sdk_publish?project=YOUR_GCP_PROJECT>

Only after steps 4–5 do org editors get the update (on their next Doc reload). Changing OAuth scopes additionally triggers Marketplace re-review. The `@HEAD` deployment and the bound host Doc always run the latest pushed code, so you can test there before publishing.

### Script Properties

Set these in the Apps Script editor: **Project Settings → Script Properties**.

Style & shortcode guides (for the "Check against style & shortcode guide" tool):

| Property | Value |
|---|---|
| `STYLE_GUIDE_URL_WEBSITE` | Google Doc/tab URL for the 80000hours.org (UK English) style guide |
| `STYLE_GUIDE_URL_SUBSTACK` | Google Doc/tab URL for the Substack (US English) style guide |
| `SHORTCODE_GUIDE_URL` | Google Doc URL for the WordPress shortcode guide |

A tab-specific URL (ending `…/edit?tab=t.xxxx`) reads just that tab. If a `STYLE_GUIDE_URL_*` property is unset, that variant runs with no external guide text and the sidebar shows a warning.

LLM features:

| Property | Value |
|---|---|
| `LLM_API_KEY` | Anthropic API key |
| `LLM_PROVIDER` | `anthropic` |
| `LLM_MODEL` | e.g. `claude-sonnet-4-6` (optional, uses provider default) |

WordPress export (required for image uploads in the Prepare for WordPress tool):

| Property | Value |
|---|---|
| `WP_BASE_URL` | e.g. `https://80000hours.org` |
| `WP_CREDENTIALS` | `email:password` (e.g. `api-user@80000hours.org:thepassword`) |

The WordPress tool has a **Debug WordPress connection** panel in the sidebar that verifies credentials without doing a full export.

## Testing

## Known limitations

- Multi-login (multiple Google accounts in the same Chrome session) causes `PERMISSION_DENIED` errors. Use incognito or a single-account Chrome profile.
- No real-time checking — all tools must be triggered manually from the menu.
- Cannot create suggestion-mode edits (Google Docs API limitation).
- Archive external links: some URLs (paywalls, certain government sites) can't be fetched by the Wayback Machine's Save Page Now service. These are reported in the sidebar with a manual fallback link.
- Prepare for WordPress: images are uploaded to WordPress on first export and then cached by hash. If the same image later needs a different URL (e.g. the media library was migrated), run `clearImageUploadCache()` from the script editor to force re-upload.
