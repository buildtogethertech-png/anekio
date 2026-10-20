# Android: from code to Google Play

The whole flow, in order. Every command runs from the repository root (`~/anekio`) unless it says otherwise.

```
1. Dev (live reload)  →  2. Preview (release build check)  →  3. AAB  →  4. Google Play  →  5. After release
   "Anekio Dev"            "Anekio Preview"                     build      upload + roll out     (force update if needed)
```

Three apps can live on one phone at the same time:

| App | ID | Used for |
| --- | --- | --- |
| **Anekio Dev** | `in.anekio.school.dev` | Coding with live reload |
| **Anekio Preview** | `in.anekio.school.preview` | Checking a release build before Play |
| **Anekio** | `in.anekio.school` | The real Play Store app |

---

## 0. One-time setup (new Mac)

```bash
# Android tools
brew install android-platform-tools          # adb
brew install --cask zulu@17                  # Java 17
# Install Android Studio once (it brings the Android SDK), then add to ~/.zshrc:
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# Expo / EAS
npm install                                  # root (server)
npm --prefix mobile install                  # app
npx eas-cli login                            # Expo account: buildtogether
```

Faster local builds: put this in `~/.gradle/gradle.properties` (use `-Xmx4g` on an 8 GB Mac):

```
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.jvmargs=-Xmx6g -XX:+UseParallelGC
```

Phone: Settings → About phone → tap **Build number** 7×, then Settings → System → Developer options →
**USB debugging** on. Plug in, accept "Allow USB debugging", and check:

```bash
adb devices        # should list your phone as "device"
```

---

## 1. Develop: Anekio Dev (live reload)

**Install Anekio Dev once** (phone on USB, ~10–20 min the first time). Re-run only when you add/upgrade a
native package or change `mobile/app.json`:

```bash
npm run android:dev
```

**Every day:**

```bash
npm run api            # terminal 1: local server
npm run app            # terminal 2: Metro (live reload)
```

Open **Anekio Dev** on the phone and pick the server (`http://<your-mac-ip>:8081`, or `http://localhost:8081`
after `adb reverse tcp:8081 tcp:8081` when on USB). Code changes appear instantly.

**Before moving on, test in release mode once** (catches "works in dev, crashes in the real app" bugs):

```bash
cd mobile && npx expo start -c --no-dev --minify
```

Seeing a crash? Read the phone log while you reproduce it:

```bash
adb logcat -c && adb logcat '*:S' ReactNativeJS:V ReactNative:V AndroidRuntime:E
```

---

## 2. Check the release build: Anekio Preview

**Fast (local, ~3–10 min, no Expo credits).** Talks to production (`app.anekio.com`):

```bash
npm run build-apk:quick
adb install -r mobile/anekio-preview.apk          # always the latest quick build
```

Against staging instead:

```bash
API_URL=https://app.staging.anekio.com npm run build-apk:quick
```

No cable? Send the `.apk` to the phone (WhatsApp/Drive) and tap it to install.

**Checklist on Anekio Preview** (do all of it before every release):

- [ ] Log in as office, teacher and parent
- [ ] Dashboard, Exams, Settings, Fees, Attendance open without crashing
- [ ] Setup rocket opens
- [ ] Invoice / receipt opens inside the app
- [ ] Attendance QR camera works
- [ ] Notifications arrive
- [ ] Rotate the phone once (landscape still usable)

> Deploy the **server** (Vercel) and run the production DB migration *before* releasing an app that needs new
> server features: `bash scripts/migrate.sh --env .env.production --preview`, then without `--preview`.

---

## 3. Build the AAB for Google Play

The build number (Android `versionCode`) lives in `mobile/app.json` and goes up by 1 automatically before every
production build (`scripts/bump-android-version.js`). Commit `mobile/app.json` after a release so the number is kept.

```bash
npm run build:number            # show the last number and the next one
npm run build:number:set -- 15  # only if Play ever says a number is already used: set the last used one
```

**On your Mac (no Expo credits, ~15–25 min):**

```bash
npm run build:aab:production:local
```

Output: `mobile/build-<number>.aab`.

**Or in Expo's cloud (~10–15 min, uses Expo free-plan builds):**

```bash
npm run build:aab:production
```

Download the `.aab` from the link it prints (also at expo.dev → project → Builds).

Optional: change the user-facing version (e.g. `0.1.0` → `0.2.0`) in `mobile/app.json` → `"version"` before
building. The build number does not need touching.

If Play says *"Version code N has already been used"*: `npm run build:number:set -- N`, then build again.

---

## 4. Release on Google Play

1. Play Console → **Anekio** → **Test and release** → **Internal testing** → **Create new release**.
2. Upload the `.aab`, add release notes, **Save** → **Review release** → **Start rollout**.
3. Install it from the internal-testing link on your phone and do a quick smoke test.
4. When happy: open that release → **Promote release** → **Production** (start with a staged rollout,
   e.g. 20%, then raise it to 100%).

Or upload from the terminal (cloud build only):

```bash
cd mobile && npx eas-cli submit --platform android --profile production
```

Note the release name Play shows, e.g. **"12 (0.1.0)"**: `12` is the build number.

---

## 5. After release (and emergencies)

**Check:** install from Play, open the app, confirm **Profile → bottom** shows the new build
(`Anekio v0.1.0 (build 12)`).

**Make users update** (admin console → **Operations → App version**):

| Field | Effect |
| --- | --- |
| Suggest update — latest build | Builds below this see a dismissible "New version available" banner |
| Force update — minimum build | Builds below this are **blocked** with a full-screen "Update on Play Store" (no way to close it) |

Rules:
- Only set the minimum **after** the new build is live on Play, otherwise users have nothing to update to.
- `0` turns a rule off. Changes reach apps within ~15 seconds (on open / when they return to the app).
- Only the Play app (**Anekio**) is ever blocked; Dev and Preview never are.

Test the blocker in Dev: set minimum to `20` in the admin console, then
`cd mobile && EXPO_PUBLIC_FAKE_APP_BUILD=5 npx expo start -c`.

---

## Quick reference

| Step | Command |
| --- | --- |
| Install Anekio Dev (once) | `npm run android:dev` |
| Daily dev | `npm run api` + `npm run app` |
| Release-mode check in Expo | `cd mobile && npx expo start -c --no-dev --minify` |
| Anekio Preview APK | `npm run build-apk:quick` → `adb install -r mobile/anekio-preview.apk` |
| Play AAB (local) | `npm run build:aab:production:local` |
| Play AAB (cloud) | `npm run build:aab:production` |
| Upload to Play (cloud build) | `cd mobile && npx eas-cli submit --platform android --profile production` |
| Show / fix build number | `npm run build:number` · `npm run build:number:set -- N` |
| Crash log | `adb logcat -c && adb logcat '*:S' ReactNativeJS:V AndroidRuntime:E` |
| Remove an app from the phone | `adb uninstall in.anekio.school.dev` (or `.preview`) |

## Common problems

| Problem | Fix |
| --- | --- |
| `Missing script: "build-apk:quick"` | You are in `mobile/`. Use `npm run build:apk:quick` there, or `cd ..` first. |
| `could not connect to TCP port 5554` | A fake emulator entry. Don't press **a** in Expo; open the app on the phone yourself. `adb kill-server && adb start-server`. |
| `more than one device/emulator` | Add `-s <serial>` from `adb devices`, e.g. `adb -s ZD222SG5W8 install -r …` |
| `zsh: no matches found: *:S` | Quote it: `'*:S'` |
| Play: "another user has installed an incompatible version" | A local build with the store ID is on the phone (maybe in a second profile). `adb uninstall in.anekio.school` |
| Expo: "used its Android builds from the Free plan" | Use the `:local` commands until the monthly reset. |
| Works in Expo Go, crashes in the APK | Reproduce with `--no-dev --minify` and read `adb logcat`. Never put CSS `animation`/`transition` rules in `global.css` (they live in `web-effects.css`). |
