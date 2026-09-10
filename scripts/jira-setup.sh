#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env.local"

read -r -p "Jira base URL: " JIRA_BASE_URL_INPUT
read -r -p "Jira email: " JIRA_EMAIL_INPUT
read -r -s -p "Jira API token: " JIRA_API_TOKEN_INPUT
printf "\n"

if [[ -z "${JIRA_BASE_URL_INPUT// }" || -z "${JIRA_EMAIL_INPUT// }" || -z "${JIRA_API_TOKEN_INPUT// }" ]]; then
  echo "Missing value. Jira setup cancelled."
  exit 1
fi

TMP_FILE="$(mktemp /tmp/anekio-jira-env.XXXXXX)"
if [[ -f "$ENV_FILE" ]]; then
  awk '!/^JIRA_BASE_URL=/ && !/^JIRA_EMAIL=/ && !/^JIRA_API_TOKEN=/' "$ENV_FILE" > "$TMP_FILE"
else
  : > "$TMP_FILE"
fi

{
  echo "JIRA_BASE_URL=$JIRA_BASE_URL_INPUT"
  echo "JIRA_EMAIL=$JIRA_EMAIL_INPUT"
  echo "JIRA_API_TOKEN=$JIRA_API_TOKEN_INPUT"
} >> "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"
echo "Saved Jira config to .env.local"
