# Mirage

A procedurally generated endless runner whose rules keep changing. Every 35–45
seconds the world **Shifts** and one rule of the game is replaced — gravity
inverts, controls mirror, the render style itself becomes pixel art or a
wireframe. Ships as an Android APK, built entirely with free tooling.

Full design: [`docs/DESIGN.md`](docs/DESIGN.md).

> **Status: Milestone 2 of 9.** Playable: procedural dune terrain, momentum that
> reads as physical, jumps, backflips, landing judgement, swept collision, and the
> `Scene`/`RenderStyle` seam the later render-style twists depend on. Still to
> come: collectibles and obstacles (M3), the twist system itself (M4), the four
> alternate render styles (M5), and generative audio (M6).

## How it plays

You run automatically. Downhill builds speed, uphill costs it, and running fast
over a crest launches you without any input — air is earned by reading the ground,
not just by pressing the button.

Landings are judged on how closely your body angle matches the slope: within 35°
is clean and pays a speed boost, up to 75° is sloppy and costs speed, beyond that
you crash. While no trick is committed the board self-levels in the air, so the
terrain alone will never kill you.

Holding the button jumps higher, and holding *past* that window commits to a
backflip. Committing disables self-levelling — once you choose to rotate, the
landing is yours to get right.

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
