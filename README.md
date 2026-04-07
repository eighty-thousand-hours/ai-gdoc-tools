# editorial-checker

Google Docs add-on that checks documents against the [Epoch AI style guide](https://docs.google.com/document/d/1pDrkYgftq0kAF16pVpWbSsGiwXsca4O6IF-kR2hc1TU/) (v3.0) and suggests corrections via a sidebar UI.

## What it does

- Scans document paragraphs for style guide violations
- Applies ~97 deterministic rules: glossary/spelling, formatting, filler phrases, math notation
- Optionally runs an LLM pass (Claude or GPT) for tone, hedging, clarity, voice, precision, and structure suggestions
- Displays issues in a sidebar with click-to-navigate highlighting and one-click fix application

## Files

| File | Description |
|---|---|
| `Code.gs` | Entry point: menu registration, document reading, fix application |
| `StyleRules.gs` | Deterministic rule engine (~65 glossary, ~24 formatting, ~8 math rules) |
| `ClaudeAPI.gs` | LLM integration (Anthropic and OpenAI), system prompt with Epoch voice guidelines |
| `Sidebar.html` | Sidebar UI: issue cards, navigation, highlighting, apply/dismiss actions |
| `appsscript.json` | Apps Script manifest and OAuth scopes |

## Rule categories

### Deterministic rules

- **Glossary/spelling**: adviser, dataset, email, Nvidia, arXiv, GPT-4, Claude 4.5, Llama, naïve, Anthropic, Gemini, PaLM, DeepSeek, etc.
- **Abbreviations**: AI (not A.I.), US (not U.S.), EU, PhD, MBA — no periods
- **Brand names**: OpenAI, ChatGPT, xAI, Wi-Fi, SWE-bench Verified, test-time compute
- **Filler phrases**: "in order to" → "to", "due to the fact that" → "because", etc.
- **Formatting**: percent symbol, leading zeros, decade apostrophes, en dashes for ranges, -ly adverb hyphenation, abbreviated units, date formats (ordinals, month-year commas, European dates), a.m./p.m., noon/midnight, contractions, company singular pronouns, ampersands, /year → per year
- **Math notation**: multiplication sign (× not x), multiplier notation (4× faster), caret notation, e-notation, FLOP unit, numeric range en dashes

### AI-powered suggestions

When enabled, an LLM reviews the document for issues that require human judgment:

- **Tone**: hype language, unsubstantiated superlatives, buzzwords
- **Hedging**: overclaiming ("proves" → "suggests") and excessive hedging
- **Clarity**: ambiguous pronouns, overly long sentences, unexplained jargon
- **Voice**: passive voice, cross-sentence company pronoun misuse
- **Precision**: vague quantifiers ("many", "significant", "various")
- **Structure**: restrictive "which" → "that", dangling modifiers, parallel structure

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
- The Marketplace add-on requires a versioned deployment update (`clasp version` + `clasp deploy -i <id> -V <n>`) to propagate code changes.
