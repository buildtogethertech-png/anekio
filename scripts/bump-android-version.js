#!/usr/bin/env node
/**
 * Keeps the Android build number (versionCode) in mobile/app.json and adds 1 before every Play build.
 * Play needs every upload to have a higher number; with this you never look it up again.
 *
 *   node scripts/bump-android-version.js          # +1 and save (used by the build scripts)
 *   node scripts/bump-android-version.js --show   # just print the current number
 *   node scripts/bump-android-version.js --set 15 # set it (e.g. if Play says a number is already used)
 *
 * First run: if app.json has no versionCode yet, it starts from Expo's stored number
 * (`eas build:version:get`), so it continues where you were.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const file = path.join(__dirname, "..", "mobile", "app.json");
const json = JSON.parse(fs.readFileSync(file, "utf8"));
json.expo.android = json.expo.android || {};
const args = process.argv.slice(2);

function save(code) {
  json.expo.android.versionCode = code;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}

function fromExpo() {
  try {
    const out = execSync("npx eas-cli build:version:get -p android -e production", {
      cwd: path.join(__dirname, "..", "mobile"),
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const match = out.match(/versionCode\D*(\d+)/i);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

let current = Number(json.expo.android.versionCode) || 0;

if (args[0] === "--set") {
  const value = Number(args[1]);
  if (!Number.isInteger(value) || value < 1) {
    console.error("Usage: node scripts/bump-android-version.js --set <number>");
    process.exit(1);
  }
  save(value);
  console.log(`Android build number set to ${value}. The next build will be ${value + 1}.`);
  process.exit(0);
}

if (!current) {
  current = fromExpo();
  if (!current) {
    console.error("No build number yet. Set the last number Play has, e.g.: node scripts/bump-android-version.js --set 12");
    process.exit(1);
  }
  console.log(`Starting from Expo's last build number: ${current}`);
}

if (args[0] === "--show") {
  console.log(`Last Android build number: ${current} (next build: ${current + 1})`);
  process.exit(0);
}

const next = current + 1;
save(next);
console.log(`Android build number: ${current} → ${next} (saved in mobile/app.json)`);
