#!/usr/bin/env bash
# PreToolUse(Bash) hook: when a clasp deploy/publish command runs, remind that
# org users don't get the update until the GCP Marketplace SDK version is bumped
# and the Store Listing is re-published.
c=$(jq -r '.tool_input.command // empty')
if printf '%s' "$c" | grep -Eq 'clasp[[:space:]]+(push|create-version|version|deploy|update-deployment|redeploy)'; then
  jq -n '{
    systemMessage: "⚠️ clasp updates the SCRIPT only. Org users will NOT get this until you bump the GCP Marketplace SDK App Configuration version (\"Docs add-on script version\") AND re-publish the Store Listing. Links are in the README publish section.",
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: "Deploy/publish reminder: clasp push/create-version/deploy do NOT roll out to org users. After deploying, remind the user to (1) bump the version in the GCP Marketplace SDK App Configuration and (2) re-publish the Store Listing, pointing them to the README links."
    }
  }'
fi
exit 0
