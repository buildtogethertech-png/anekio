#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const [, , command = "help", ...args] = process.argv;

loadDotEnv(".env.local");

const baseUrl = normalizeBaseUrl(process.env.JIRA_BASE_URL || "");
const email = process.env.JIRA_EMAIL || "";
const token = process.env.JIRA_API_TOKEN || "";

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function requireConfig() {
  const missing = [];
  if (!baseUrl) missing.push("JIRA_BASE_URL");
  if (!email) missing.push("JIRA_EMAIL");
  if (!token) missing.push("JIRA_API_TOKEN");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Add them to .env.local or export them in your shell.`);
  }
}

async function jira(path, init = {}) {
  requireConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.errorMessages?.join("; ") || body?.message || `Jira request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = args.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function whoami() {
  const user = await jira("/rest/api/3/myself");
  console.log(`${user.displayName} <${user.emailAddress || email}>`);
}

async function projects() {
  const rows = await jira("/rest/api/3/project/search?maxResults=50");
  for (const project of rows.values || []) {
    console.log(`${project.key}\t${project.name}`);
  }
}

async function createIssue() {
  const projectKey = arg("project");
  const summary = arg("summary");
  const description = arg("description");
  const issueType = arg("type", "Task");
  if (!projectKey || !summary) {
    throw new Error("Usage: npm run jira:create -- --project=KAN --summary=\"Fix bug\" --description=\"Details\" --type=Task");
  }
  const created = await jira("/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
        ...(description
          ? {
              description: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: description }],
                  },
                ],
              },
            }
          : {}),
      },
    }),
  });
  console.log(`${created.key} ${baseUrl}/browse/${created.key}`);
}

async function addComment() {
  const issue = arg("issue");
  const body = arg("body");
  if (!issue || !body) {
    throw new Error("Usage: npm run jira:comment -- --issue=KAN-123 --body=\"Changed files and verification notes\"");
  }
  const created = await jira(`/rest/api/3/issue/${encodeURIComponent(issue)}/comment`, {
    method: "POST",
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: body }],
          },
        ],
      },
    }),
  });
  console.log(`Comment added to ${issue}: ${baseUrl}/browse/${issue}?focusedCommentId=${created.id}`);
}

async function main() {
  if (command === "whoami") return whoami();
  if (command === "projects") return projects();
  if (command === "create") return createIssue();
  if (command === "comment") return addComment();
  console.log(`Usage:
  npm run jira:whoami
  npm run jira:projects
  npm run jira:create -- --project=KAN --summary="Fix bug" --description="Details" --type=Task
  npm run jira:comment -- --issue=KAN-123 --body="Changed files and verification notes"`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
