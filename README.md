# epoch-ai-addon

Google Docs add-on for Epoch AI. Provides editorial style checking, internal link suggestions, related article suggestions, link verification, recency checks, alt-text generation, and metadata auto-fill via sidebar UIs.

## What it does

- **Style checker**: Scans documents against Epoch's [style guide](https://docs.google.com/document/d/1pDrkYgftq0kAF16pVpWbSsGiwXsca4O6IF-kR2hc1TU/) (v3.0). ~97 deterministic rules + LLM-powered suggestions for tone, hedging, clarity, voice, precision, and structure.
- **Internal link suggestions**: Sends document text + site catalog to Claude, suggests inline links to relevant Epoch publications.
- **Related articles**: Suggests publications for the relatedWork frontmatter.
- **Research helper**: Verifies that each external hyperlink in the document actually supports the claim in the surrounding sentence (fetches the target page, asks Claude to compare). Sidebar groups results by status — OK / need attention / couldn't verify (paywalls, anti-bot, gov pages) — with a summary line and OK cards collapsed by default. Also runs a recency check that uses Claude's web-search tool with extended thinking to flag claims that may have been contradicted or updated in the last 14 days; each finding carries a "Why flagged" reasoning surfaced in the UI.
- **Generate alt text**: Enumerates every image in the document and produces short, one-sentence HTML alt descriptions suitable for audio narrations. Review and edit in the sidebar before applying. Apply writes `[<alt text>]` as a paragraph directly below the image (matching Epoch's publication automation) and keeps the alt-description metadata in sync; repeated Applies replace the existing bracketed paragraph in place.
- **Generate metadata**: Finds the Metadata table (prefers a "Metadata" tab) and auto-fills Tags (from the canonical site tag list), HTML title, and HTML meta.

## Files

| File | Description |
|---|---|
| `Code.gs` | Entry point: menu registration, document reading, fix/link application |
| `StyleRules.gs` | Deterministic rule engine (~65 glossary, ~24 formatting, ~8 math rules) |
| `ClaudeAPI.gs` | LLM integration (Anthropic and OpenAI): style check, link suggestions, related work, alt text, link verification, recency check, metadata |
| `Catalog.gs` | Site catalog (auto-generated from `full-catalog.json` in internal-linking-automation) |
| `ImageTools.gs` | Image enumeration + alt-text application |
| `ResearchHelper.gs` | External-link enumeration, URL fetching + HTML stripping, recency-check driver |
| `MetadataTools.gs` | Metadata table location + apply logic, canonical tag extraction |
| `Sidebar.html` | Style checker sidebar UI |
| `LinksSidebar.html` | Internal links + related articles sidebar UI |
| `AltTextSidebar.html` | Alt-text generation sidebar UI |
| `ResearchSidebar.html` | Research helper sidebar UI (link verification + recency check tabs) |
| `MetadataSidebar.html` | Metadata generation sidebar UI |
| `appsscript.json` | Apps Script manifest and OAuth scopes |

## Setup

Deployed as an internal Marketplace add-on via [`clasp`](https://github.com/google/clasp). There are two script projects: a standalone script (Marketplace deployment) and a container-bound script (development).

```bash
npm install -g @google/clasp
clasp login
clasp push                    # pushes to standalone script (.clasp.json)

# To push to the container-bound script:
cp .clasp.json .clasp.json.standalone
cp .clasp.json.container-bound .clasp.json
clasp push
cp .clasp.json.standalone .clasp.json
```

After pushing, create a version and update the Marketplace deployment:

```bash
clasp version "description"
clasp deploy -i AKfycbx-qsmqSGDrqcZqMjGcjk-cmx-t_aIaABGPmoczNJb9Nf4wOwhQzEf02b2SdtIz65mF -V <new-version-number>
```

**Important**: also update the version number in the GCP Marketplace SDK App Configuration (`Docs add-on script version` field), then publish from the Store Listing tab.

LLM features require an API key configured in Script Properties:

| Property | Value |
|---|---|
| `LLM_API_KEY` | Anthropic or OpenAI API key |
| `LLM_PROVIDER` | `anthropic` (default) or `openai` |
| `LLM_MODEL` | e.g. `claude-sonnet-4-20250514` (optional, uses provider default) |

Set these in the Apps Script editor: Project Settings → Script Properties.

## Testing

Two Google Docs are maintained for manual regression testing:

- **Kitchen sink** — [doc `1xcx-NLYEQm7kizBIkeQsdO8QGF59rDD3BzhsI8PtwUk`](https://docs.google.com/document/d/1xcx-NLYEQm7kizBIkeQsdO8QGF59rDD3BzhsI8PtwUk/edit). Exhaustive per-rule test cases for the Style checker. **Whenever a new rule is added to `StyleRules.gs`, add a matching test case here.** Also the Google Doc that hosts the container-bound dev script, so `clasp push` against `.clasp.json.container-bound` updates this doc directly.
- **Sample doc** — [doc `1YyIzaG3r6hdiA4LL3p9ENb5KsBiB2zusKNVcjT7w7AI`](https://docs.google.com/document/d/1YyIzaG3r6hdiA4LL3p9ENb5KsBiB2zusKNVcjT7w7AI/edit). Realistic doc with images, external hyperlinks, footnotes, and tables — used for end-to-end testing of Research helper, Alt text, the footnote/link-preserving Apply, and the table-skip logic.

## Known limitations

- Multi-login (multiple Google accounts in the same Chrome session) causes `PERMISSION_DENIED` errors. Use incognito or a single-account Chrome profile.
- No real-time checking — must be triggered manually from the menu.
- Cannot create suggestion-mode edits (Google Docs API limitation).
