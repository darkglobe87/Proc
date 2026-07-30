# Mirage

A procedurally generated endless runner whose rules keep changing. Every 35–45
seconds the world **Shifts** and one rule of the game is replaced — gravity
inverts, controls mirror, the render style itself becomes pixel art or a
wireframe. Ships as an Android APK, built entirely with free tooling.

Full design: [`docs/DESIGN.md`](docs/DESIGN.md).

> **Status: Milestone 1 of 9.** The spine is in place — fixed-step loop,
> deterministic seeding, touch input, DPR handling, persistence, and a working
> signed APK. What runs today is a thin vertical slice (seeded dunes, a jumping
> runner, parallax, HUD) that exists to prove the pipeline on a real device. The
> twist system, generative audio and render-style morphing land in later
> milestones.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Jump (hold for height) | tap / hold anywhere | `Space` / `↑` / `W` |
| Dive | swipe down | `↓` / `S` |
| Pause | — | `Esc` / `P` |
| Restart | — | `R` |

## Run it in a browser

The web build is the fast iteration loop; the WebView is just the final target.

```bash
npm install
npm run dev          # http://localhost:5173
```

Useful URL parameters:

- `?seed=36J-5ENN` — replay an exact course. Codes are Crockford base32 and
  always start with `0`–`3`; anything larger than 32 bits is rejected and falls
  back to a random seed.
- `?daily` — the shared Daily Run seed for the current UTC day.

## Build the APK

Requires JDK 21 and an Android SDK with `platforms;android-35` and
`build-tools;35.0.0`.

```bash
export ANDROID_HOME=/path/to/android-sdk
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

npm run android:debug     # android/app/build/outputs/apk/debug/app-debug.apk
npm run android:release    # android/app/build/outputs/apk/release/app-release.apk
```

`npm run android:*` rebuilds the web bundle and runs `cap sync` first, so the APK
always contains current web assets.

### Signing

A release APK must be signed to be installable. Create your own key — the signing
key is your app's permanent identity, and you cannot update an installed app with
a different one:

```bash
keytool -genkeypair -v -keystore android/release.keystore -alias mirage \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then create `android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/to/android/release.keystore
storePassword=…
keyAlias=mirage
keyPassword=…
```

Without a keystore, `assembleRelease` still succeeds but produces an unsigned,
uninstallable APK and logs a warning. Use `assembleDebug` for casual testing —
Android signs debug builds with its own well-known key.

### CI builds

[`.github/workflows/android.yml`](.github/workflows/android.yml) builds on every
push using free runners, uploads the APK as a workflow artifact, and attaches it
to a GitHub Release when you push a `v*` tag. To get signed CI builds, add these
repository secrets:

| Secret | Value |
| --- | --- |
| `MIRAGE_KEYSTORE_B64` | `base64 -w0 android/release.keystore` |
| `MIRAGE_KEYSTORE_PASSWORD` | keystore password |
| `MIRAGE_KEY_ALIAS` | key alias |
| `MIRAGE_KEY_PASSWORD` | key password |

Without them CI falls back to a debug APK, so pull requests from forks still
build.

Sideloading needs no Play Console. Publishing to the Play Store later is a
one-time $25 registration.

## Tests

```bash
npm test          # vitest
npm run typecheck
```

The determinism tests are the important ones: a seed must always produce the same
course, and each subsystem draws from its own named RNG stream so that changing
one system cannot shift another's sequence and invalidate shared seeds.
