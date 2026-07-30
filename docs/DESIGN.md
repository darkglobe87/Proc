# MIRAGE — procedural endless runner with morphing twists (Android APK)

*(working title — rename freely)*

## Context

`darkglobe87/Proc` is an empty repository. Goal: build from scratch a procedurally
generated endless runner whose **rules periodically mutate** into a new twist each time —
the "That Level Again" surprise loop — with Alto's-Odyssey-grade presentation that
**changes render style with the twist**, a generative Web Audio score, non-coin
collectibles, easter-egg areas reached by precise jumps, and standard game meta.
It must ship as an **Android APK, built entirely with free tooling**.

The core bet: **the twist system is the game.** Terrain, art and music are the stage;
longevity comes from never knowing which rule breaks next, plus a discoverable
catalogue that rewards playing long enough to see everything.

**Decisions locked from your answers:** silhouette base whose render style morphs per
twist · hand-rolled Web Audio with a serious FX chain · full gremlin mode · Android APK.
**Assumed (flip any):** landscape-locked · sideloaded via GitHub Releases (no Play
Console) · gremlins unlocked after 3 runs, toggleable.

---

## 1. How it becomes a free APK

Verified in this container: **JDK 21** and **Gradle** present; `dl.google.com`
cmdline-tools and Google Maven both reachable (HTTP 200); 30 GB disk free.

**Web-first game, native shell.** Vite + TypeScript + Canvas2D, wrapped by
**Capacitor 7** (MIT) into an Android WebView app. Nothing in the chain costs money:
Capacitor, Android SDK command-line tools, Gradle, and self-signed release keystores are
all free, and sideloaded APKs need no Play Console.

Two build paths, both implemented:

- **A — in-session build** (so you get an APK to hold today): install cmdline-tools to
  `~/android-sdk`, accept licences, then `npm run build && npx cap sync android &&
  cd android && ./gradlew assembleRelease` against a generated keystore. Delivered via
  `SendUserFile`.
- **B — `.github/workflows/android.yml`** (reproducible, free runners): setup-java 21 →
  setup-android → `npm ci` → vite build → `cap sync` → `assembleRelease`, signed from
  repo secrets, uploaded as a workflow artifact and attached to a GitHub Release on tag.

Keystore handling: generated, **never committed**, base64 into `ANDROID_KEYSTORE_B64` +
password secrets. The in-session keystore is a throwaway — you'll want your own before
distributing anything, since the signing key is your app's permanent identity.
The `android/` directory is committed so the native shell stays reviewable and
reproducible. `dist/` web build also stays playable in a browser — that's the fast
iteration loop; the WebView is just the final target.

**Why not the alternatives:** Bubblewrap/TWA needs HTTPS hosting + asset-links and hands
control of fullscreen/immersive to Chrome; Cordova is the legacy version of the same
idea; rewriting in Godot would discard the Web Audio and Canvas render-morphing work
that the twist design depends on.

## 2. Core loop

Auto-run left→right over a continuous procedural dune curve. Touch-first, one-button
core: **tap** = jump, **hold** = higher jump / air trick, **release near ground** =
landing boost, **swipe down** = dive/fast-fall. Alto-style momentum: speed is conserved
down slopes, a clean landing grants a boost.

- **Flow**: chaining tricks / rail grinds / near-misses raises a multiplier. Breaking it
  costs the multiplier, not the run.
- **Death**: head-on obstacle contact, or landing inverted.
- **Speed** ramps with distance, capped per biome, and dips slightly on each Shift so a
  new rule always arrives with breathing room.

## 3. The Shift system (centrepiece)

Every ~35–45 s (or N metres, whichever first) the world **Shifts**: a telegraphed
transition — glyph bloom, palette wipe, music modulates — replacing one rule of the game
**and often the render style itself**.

**Fairness contract** every twist must satisfy:
1. Telegraphed ~1.5 s ahead (audio sting + visual wipe).
2. Grace corridor: no obstacle spawns for ~1.2 s after a Shift.
3. The rule is readable from the screen alone — never memorised trivia.
4. Deterministic under the run seed, so runs replay and share.

| Family | Examples |
|---|---|
| Physics | Inversion (gravity flips, world rolls 180°), Moonwalk (low-g floaty arcs), Wind (lateral force), Rubber (bouncy ground) |
| Control | Mirror (right→left, controls inverted), Metronome (jumps land only on the beat), Charge (hold-and-release to jump), Anti-jump (the button makes the *terrain* jump) |
| Perception | The Long Night (small light radius), Zoom Out (you become a speck), Slow Rotate (the "down" vector spins), plus the render-style swaps below |
| Entity | Echo (your ghost from 3 s ago collides and collects), Hunger (chimes chase *you*), Shadow (obstacles hazard-cast where their shadow lands) |
| Time | Rewind (world scrolls backward 8 s), Stutter (time advances in discrete beats) |
| Meta | §7 gremlins |

Twists **stack in pairs** after the 5th Shift, gated by a conflict matrix (Mirror +
Inversion fine; Zoom Out + Long Night not). Sampled without replacement within a run,
unseen twists weighted up.

## 4. Render-style morphing — the key architectural decision

Game code **never touches the canvas**. Each frame the world emits a `Scene`: typed
draw primitives (polylines, polygons, discs, particles, glyphs, text) in world space.
A swappable `RenderStyle` consumes it. That's what makes five styles affordable instead
of 4× the work, and it keeps twists from having to know about rendering.

- **Silhouette** (baseline, Alto's): flat dark shapes, huge gradient skies, parallax dune
  layers, haze particles, day-night cycle, scarf ribbon trail.
- **Pixel**: same scene rendered to a 320×180 offscreen, palette-quantised,
  nearest-neighbour upscaled — cheaper than baseline, and the cute pixel look you wanted.
- **Wireframe/blueprint**: stroke-only hairlines, hazards as outlines, horizon grid.
- **Papercraft**: layered flat fills with offset cut edges and shadow bands.
- **ASCII**: 160×90 luminance read-back mapped to a glyph ramp, monospace draw, throttled
  to 30 Hz.

Style is a property of the active twist, so *style change becomes a twist* — directly
serving the premise. Transitions cross-fade over ~400 ms.

## 5. Collectibles — "Chimes"

Not coins: **Chimes** are glyph-motes suspended in arcs that trace the ideal jump path,
so they teach the line.

- Each chime **plays a real note into the live soundtrack** — collecting *is* playing the
  music.
- Every 25 chimes unlocks a **musical stem** (arp → bass → pad → lead) for the rest of
  the run, so a strong run audibly grows into a full track.
- Chimes also fill the **Shift meter**: collecting brings the next twist *sooner*.
  Genuine risk/reward — bank a comfortable twist by abstaining, or feed the chaos.
- Rare **Relics** (one per easter-egg area) are permanent, logged in a gallery, each
  unlocking a palette / twist / trail.

## 6. Easter-egg areas

Hidden pockets above the skyline and beneath the dunes, entered only by a precise launch:
a specific ramp crest hit at high tangent velocity, or a 3-trick chain landed into an
updraft. Telegraphed subtly — a bird spiralling up, a shimmer in the haze, a chime arc
curving *off* the normal path. Inside: no obstacles, no timer, a short authored vignette
(a shrine, a derelict ship, a room that shouldn't exist), a Relic, one line of world
text. Exit preserves your speed.

## 7. Gremlins (full mode) — with hard safety rails

Full mischief, because a prank that eats a good run isn't funny. Non-negotiable rails,
enforced centrally in `gremlins/director.ts`, not per-gremlin:

- Never in the first 3 runs; settings toggle; never during the closing seconds of a
  personal best.
- Every gremlin self-resolves within 2.5 s **or** on the next input — never permanently
  blocks input.
- Never destroys score or save data. It may *lie* about them, then restore the truth.
- Never imitates a security, permission, payment or Play-Store dialog, and never breaks
  the real Android back gesture. Fake system UI stays stylised as the game's own.

Catalogue: fake game-over · fake "Mirage isn't responding" · render-corruption glitch
bands · score counter lying then correcting · HUD announcing a twist that isn't active ·
pause menu whose buttons flee your finger · fake "loading…" hitch · fake toast · credits
rolling mid-run · fake low-battery overlay · the Shift banner naming the wrong twist.

## 8. Music

Seeded generative score, tempo-locked to run speed, diegetically tied to chimes (§5).

- Key/mode per biome (Dorian, Lydian, minor pentatonic), modulating on each Shift.
- Seeded Markov walk over a diatonic chord set → 4/8-bar progressions.
- Voices: pad, sub bass, plucked arp, bell/marimba lead, hand percussion — each a stem
  that fades in as it unlocks.
- **Quality comes from the FX chain, not the note generator**: one shared convolution
  reverb (procedurally generated impulse response), stereo ping-pong delay, bus
  compression with sidechain duck on the kick, detune/chorus on pads.
- Twists mangle the mix: Long Night → lowpass + longer tail; Rewind → tape-reverse;
  Metronome → percussion foregrounded so the beat is legible.
- **WebView specifics**: `AudioContext` starts suspended → resume on first touch behind a
  "tap to begin" gate; `latencyHint: 'interactive'`; note scheduling on a
  `setInterval` 250 ms lookahead, **not** rAF, because WebView throttles rAF.

## 9. Meta / basic game functions

High score and personal bests (distance, chimes, twists survived, longest flow chain) ·
run summary with a shareable **seed code** · **Daily Run** on a date-derived seed ·
**Twistdex** catalogue unlocked by surviving each twist · Relic gallery · settings
(volumes, screen shake, reduced motion, colourblind-safe palettes, high-contrast hazards,
gremlin toggle) · pause · restart. Persistence via `localStorage`, no backend.

## 10. Android performance budget

Mid-range 2020 phone at 60 fps is the target. Cap DPR at 2 and internal width at 1080 ·
**no `shadowBlur`** (pathologically slow in WebView) · sky and parallax layers cached to
offscreen canvases, redrawn only on palette change · pool every entity · one convolver,
≤12 concurrent voices · fixed 60 Hz sim with interpolated render and a clamped `dt` so
WebView suspend/resume can't tunnel the player through terrain · auto-downscale internal
resolution if frame time exceeds 20 ms for 2 s.

---

## 11. Files to create

```
package.json · tsconfig.json · vite.config.ts · index.html · capacitor.config.ts
.github/workflows/android.yml
android/                          (generated by `cap add android`, committed)
src/
  main.ts                         bootstrap, canvas sizing, orientation lock
  core/{loop,rng,input,storage,events}.ts
  world/{terrain,chunks,collision,biome}.ts
  player/player.ts
  twists/registry.ts              Twist interface, pool, conflict matrix, scheduler
  twists/*.ts                     one per twist
  render/renderer.ts              Scene + RenderStyle interfaces, layer pipeline
  render/styles/{silhouette,pixel,wireframe,papercraft,ascii}.ts
  render/{sky,particles}.ts
  audio/{engine,instruments,composer,sfx}.ts
  gremlins/director.ts + gremlins/*.ts
  ui/{hud,menu,twistdex,relics,settings,summary}.ts
tests/                            vitest
```

Core reusable pieces to build once and lean on everywhere: `core/rng.ts` (all
procedural systems derive a named sub-stream from the run seed — never `Math.random`),
`core/events.ts` (twists subscribe rather than reaching into the player), and
`render/renderer.ts`'s `Scene` (the seam that makes §4 cheap).

## 12. Milestones

1. **Skeleton + APK spine** — Vite/TS project, fixed-step loop, seeded RNG, Capacitor
   Android added, one APK built end-to-end and delivered. De-risks the packaging first.
2. **Runner feel** — terrain heightfield, collision, jump/hold/dive, tricks, camera,
   silhouette style, death/restart.
3. **Chimes, obstacles, rails, flow multiplier, HUD, high score.**
4. **Twist framework** — registry, scheduler, telegraph, grace corridor, conflict
   matrix, plus 6 physics/control twists.
5. **Render styles** — the four non-baseline styles and style-swap twists.
6. **Audio engine** — FX chain, instruments, composer, chime notes, stem unlocks.
7. **Easter eggs + Relics + Twistdex + settings + Daily Run.**
8. **Gremlin director + catalogue.**
9. **Polish pass** — perf on-device, biomes, day-night, signed release APK + Release
   pipeline.

## 13. Verification

- `npm run dev` in Chromium (preinstalled, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`)
  driven by Playwright: force each twist and each render style via a debug URL param,
  screenshot every one, eyeball for readability and correctness.
- **Determinism test** (vitest): a fixed seed run headless for 10 k sim steps produces an
  identical hash of terrain samples, obstacle placements and the twist sequence. This is
  the regression net for every procedural system.
- **Twist scheduler tests**: no repeat before pool exhaustion, no conflicting pair, grace
  corridor always obstacle-free.
- **Audio smoke test**: render 10 s via `OfflineAudioContext`, assert output is non-silent
  and never clips (peak < 0.99), and that the composer only emits in-scale pitches.
- **Gremlin rail tests**: every registered gremlin self-terminates ≤2.5 s, restores any
  value it faked, and leaves input responsive.
- **APK**: `./gradlew assembleRelease` succeeds, `unzip -l` confirms
  `classes.dex` + web assets, `apksigner verify` passes. Then you sideload and confirm
  60 fps, audio after first tap, landscape lock, and that the back gesture behaves.
