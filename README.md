# editorial-checker

Google Docs add-on that checks documents against the [Epoch AI style guide](https://docs.google.com/document/d/1iZg2yehnMTdaCXbPVsheBclLMfDWqr8IwNmQQwl4b7U/) (v3.0) and suggests corrections via a sidebar UI.

## What it does

- Scans document paragraphs for style guide violations
- Applies ~70 deterministic rules: glossary/spelling, formatting, filler phrases, math notation
- Optionally runs an LLM pass (Claude or GPT) for tone, hedging, and voice suggestions
- Displays issues in a sidebar with click-to-navigate highlighting and one-click fix application

## Files

| File | Description |
|---|---|
| `Code.gs` | Entry point: menu registration, document reading, fix application |
| `StyleRules.gs` | Deterministic rule engine (~50 glossary, ~15 formatting, ~7 math rules) |
| `ClaudeAPI.gs` | LLM integration (Anthropic and OpenAI), system prompt with Epoch voice guidelines |
| `Sidebar.html` | Sidebar UI: issue cards, navigation, highlighting, apply/dismiss actions |
| `appsscript.json` | Apps Script manifest and OAuth scopes |

## Rule categories

- **Glossary/spelling**: adviser, dataset, email, Nvidia, arXiv, GPT-4, Claude 4.5, Llama, etc.
- **Filler phrases**: "in order to" -> "to", "due to the fact that" -> "because", etc.
- **Formatting**: percent symbol after numbers, leading zeros, decade apostrophes, en dashes for ranges, -ly adverb hyphenation, abbreviated units, European dates, contractions
- **Math notation**: multiplication sign (x vs. x), caret notation, e-notation, FLOP unit

## Setup

Deployed as a container-bound Apps Script project via [`clasp`](https://github.com/google/clasp).

```bash
npm install -g @google/clasp
clasp login
clasp push
```

LLM features require an API key configured in Script Properties (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).

## Known limitations

- Multi-login (multiple Google accounts in the same Chrome session) causes `PERMISSION_DENIED` errors. Use incognito or a single-account Chrome profile.
- No real-time checking — must be triggered manually from the menu.
- Cannot create suggestion-mode edits (Google Docs API limitation).
