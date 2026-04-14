# epoch-ai-addon

Google Docs add-on for Epoch AI. Provides editorial style checking, internal link suggestions, and related article suggestions via sidebar UIs.

## What it does

- **Style checker**: Scans documents against Epoch's [style guide](https://docs.google.com/document/d/1pDrkYgftq0kAF16pVpWbSsGiwXsca4O6IF-kR2hc1TU/) (v3.0). ~97 deterministic rules + LLM-powered suggestions for tone, hedging, clarity, voice, precision, and structure.
- **Internal link suggestions**: Sends document text + 301-entry site catalog to Claude, suggests inline links to relevant Epoch publications (blog posts, data insights, newsletters, benchmark pages).
- **Related articles**: Suggests publications for the relatedWork frontmatter.

## Files

| File | Description |
|---|---|
| `Code.gs` | Entry point: menu registration, document reading, fix/link application |
| `StyleRules.gs` | Deterministic rule engine (~65 glossary, ~24 formatting, ~8 math rules) |
| `ClaudeAPI.gs` | LLM integration (Anthropic and OpenAI): style checking, link suggestions, related work |
| `Catalog.gs` | Site catalog (auto-generated from `full-catalog.json` in internal-linking-automation) |
| `Sidebar.html` | Style checker sidebar UI |
| `LinksSidebar.html` | Internal links + related articles sidebar UI |
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

## Known limitations

- Multi-login (multiple Google accounts in the same Chrome session) causes `PERMISSION_DENIED` errors. Use incognito or a single-account Chrome profile.
- No real-time checking — must be triggered manually from the menu.
- Cannot create suggestion-mode edits (Google Docs API limitation).
