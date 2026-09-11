#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_BRANCH="staging"
SOURCE_BRANCH="main"
VERCEL_PROJECT="anekio-staging"

cd "$PROJECT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to switch branches with uncommitted changes."
    echo "Commit, stash, or discard local changes before deploying staging."
    exit 1
  fi

  if git show-ref --verify --quiet "refs/heads/$EXPECTED_BRANCH"; then
    echo "Switching to existing '$EXPECTED_BRANCH' branch."
    git switch "$EXPECTED_BRANCH"
  else
    echo "Creating '$EXPECTED_BRANCH' branch from '$SOURCE_BRANCH'."
    git switch "$SOURCE_BRANCH"
    git switch -c "$EXPECTED_BRANCH"
  fi
fi

unset npm_config_prefix
source "$HOME/.nvm/nvm.sh"
nvm use 20

npm run typecheck
npm run build-app
npx vercel deploy --prod --project "$VERCEL_PROJECT"
