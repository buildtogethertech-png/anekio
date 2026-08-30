#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const steps = [
  ["Install root dependencies", "npm", ["install"]],
  ["Install mobile dependencies", "npm", ["--prefix", "mobile", "install"]],
  ["Prepare local database", "npx", ["prisma", "db", "push"]],
  ["Seed demo data", "npm", ["run", "db:seed"]],
];

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`\nSetup stopped at: ${label}`);
    process.exit(code);
  }
}

if (!existsSync("package.json") || !existsSync("mobile/package.json") || !existsSync("prisma/schema.prisma")) {
  console.error("Run this from the project root.");
  process.exit(1);
}

for (const [label, command, args] of steps) {
  run(label, command, args);
}

console.log(`
Local setup complete.

Start the API:
  npm run api

Start the Expo app in another terminal:
  npm run app

Local browser URLs:
  http://localhost:4000/          Anekio marketing page
  http://app.localhost:4000/      ERP app shell
  http://admin.localhost:4000/    admin portal
  http://localhost:8081/          Expo dev server

Host-header checks:
  curl -H "Host: anekio.com" http://127.0.0.1:4000/
  curl -H "Host: app.anekio.com" http://127.0.0.1:4000/
  curl -H "Host: admin.anekio.com" http://127.0.0.1:4000/

Every demo login uses password: 12345
See Anekio-demo-logins.json after seeding.
`);
