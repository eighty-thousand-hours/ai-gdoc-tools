# Working in this repo (notes for AI assistants)

This is a Google Docs add-on for 80,000 Hours, deployed via `clasp` and published
to the org through the **Google Workspace Marketplace SDK**.

## ⚠️ Deploying / publishing — read before you deploy

`clasp push`, `clasp create-version`, and `clasp update-deployment` update the
**script only**. They do **NOT** roll the update out to the org's editors.

**Whenever the user asks you to deploy or publish — or you run any `clasp`
deploy/version/redeploy command — you MUST remind them of the manual publish
steps** (and offer the links), because the rollout is incomplete without them:

1. **Bump the version** in the GCP Marketplace SDK **App Configuration**
   (`Docs add-on script version` field).
2. **Re-publish** from the **Store Listing** tab.

The exact commands and the direct GCP console links are in
[`README.md`](README.md) → "Publishing an update to the whole org".

Until steps 1–2 are done, org users keep running the previously published
version, even though `clasp` reported success.
