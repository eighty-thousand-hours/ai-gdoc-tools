# Notes for AI assistants

Canonical guidance for any AI assistant working in this repo. Claude Code reads
`CLAUDE.md`, which imports this file (`@AGENTS.md`); other tools read this file
directly. See `README.md` for full setup and commands.

## Deploying / publishing — read before you deploy

`clasp push`, `clasp create-version`, and `clasp update-deployment` update the
**script only**. They do **NOT** roll the update out to the org's editors.

**Whenever the user asks you to deploy or publish — or you run any `clasp`
deploy/version/redeploy command — you MUST remind them** to finish the rollout:

1. Bump the version in the GCP Marketplace SDK **App Configuration**
   (`Docs add-on script version`).
2. Re-publish from the **Store Listing** tab.

Commands and the direct console links are in `README.md` → "Publishing an update
to the whole org". Until both steps are done, org users keep the old version.

## Project shape

- Google Apps Script add-on for Google Docs — **no npm/build step**. Server code
  is `.gs`, sidebar UIs are `.html`. Deployed with `clasp`.
- All tools read/write the **active document tab** via `getActiveBody_()`. Don't
  reintroduce `DocumentApp.getActiveDocument().getBody()` for document content.
- Config (style-guide URLs, LLM key, WordPress creds) lives in **Script
  Properties**, never in code.

## Copy-writing style

- 80,000 Hours uses **British English** in user-facing copy (and the website
  style guide); the **Substack** variant uses **American English**.
- Code identifiers and comments are written in American English.
