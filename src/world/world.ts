/**
 * The world: terrain plus everything standing on it.
 *
 * This is the resolution half of the spec/resolve split. `chunks.ts` decides *what* exists
 * from the seed alone, with no notion of height; `World` turns those specs into positioned
 * entities using the terrain, caches them per chunk, and answers the spatial queries the
 * player and renderer need.
 *
 * Collected chimes are tracked by id in a set that is **not** part of the chunk cache. A
 * chunk that scrolls out of range is discarded and regenerated identically on return, so
 * storing "collected" on the entity would hand the player their pickups back. Only
 * observable once Rewind exists — which is exactly why it is handled now.
 */

import type { Rng } from '../core/rng';
import { Terrain } from './terrain';
import { MAX_SPAWN_REACH, chunkIndexAt, type SpawnSpec } from './chunks';
import type { Chime } from './chimes';
import { resolveObstacle, type Obstacle } from './obstacles';
import { resolveLedge, type Solid } from './solids';

interface ResolvedChunk {
  chimes: Chime[];
  obstacles: Obstacle[];
  solids: Solid[];
}

/** Chunks either side of the player to keep resolved. */
const KEEP_RADIUS = 3;

export class World {
  readonly terrain: Terrain;

  private readonly resolved = new Map<number, ResolvedChunk>();
  private readonly collected = new Set<number>();

  /** Reused scratch arrays; queries run every frame and must not allocate. */
  private readonly chimeScratch: Chime[] = [];
  private readonly obstacleScratch: Obstacle[] = [];
  private readonly solidScratch: Solid[] = [];

  constructor(rng: Rng) {
    this.terrain = new Terrain(rng, 0);
  }

  /**
   * Named ranges in which hazards are hidden.
   *
   * Keyed rather than a single slot, because two callers need suppression
   * independently and neither should be able to clear the other's: the twist
   * scheduler's grace corridor turns its own entry on at every Shift and off again
   * ~1.2s later, while the `?nohazards` dev flag sets a permanent, run-long entry once.
   * A single shared slot would have the grace window's teardown wipe out the dev
   * flag's suppression the first time any Shift landed — which is exactly what
   * happened before this was keyed. Lives here rather than in twist code so obstacles
   * never need to know twists exist.
   */
  private readonly suppressions = new Map<string, { from: number; to: number }>();

  /** Clears per-run state. Terrain and spawn specs are seed-derived and unaffected. */
  reset(): void {
    this.collected.clear();
    this.suppressions.clear();
  }

  /** Hides hazards between two x positions, under `key`. Replaces that key's own range. */
  suppressHazards(key: string, fromX: number, toX: number): void {
    this.suppressions.set(key, { from: fromX, to: toX });
  }

  /** Clears only this key's suppression; other keys are unaffected. */
  clearHazardSuppression(key: string): void {
    this.suppressions.delete(key);
  }

  private isSuppressed(x: number): boolean {
    for (const range of this.suppressions.values()) {
      if (x >= range.from && x <= range.to) return true;
    }
    return false;
  }

  get collectedCount(): number {
    return this.collected.size;
  }

  isCollected(chime: Chime): boolean {
    return this.collected.has(chime.id);
  }

  /** Marks a chime taken. Returns false if it had already been collected. */
  collect(chime: Chime): boolean {
    if (this.collected.has(chime.id)) return false;
    this.collected.add(chime.id);
    return true;
  }

  /**
   * Uncollected chimes within a window. Returns a reused array — iterate immediately.
   */
  chimesNear(x: number, reach = MAX_SPAWN_REACH): readonly Chime[] {
    this.chimeScratch.length = 0;
    for (const chunk of this.chunksSpanning(x, reach)) {
      for (const chime of chunk.chimes) {
        if (chime.x < x - reach || chime.x > x + reach) continue;
        if (this.collected.has(chime.id)) continue;
        this.chimeScratch.push(chime);
      }
    }
    return this.chimeScratch;
  }

  /** Obstacles within a window. Returns a reused array — iterate immediately. */
  obstaclesNear(x: number, reach = MAX_SPAWN_REACH): readonly Obstacle[] {
    this.obstacleScratch.length = 0;
    for (const chunk of this.chunksSpanning(x, reach)) {
      for (const obstacle of chunk.obstacles) {
        if (obstacle.x < x - reach || obstacle.x > x + reach) continue;
        if (this.isSuppressed(obstacle.x)) continue;
        this.obstacleScratch.push(obstacle);
      }
    }
    return this.obstacleScratch;
  }

  /** Solids overlapping a window. Returns a reused array — iterate immediately. */
  solidsNear(x: number, reach = MAX_SPAWN_REACH): readonly Solid[] {
    this.solidScratch.length = 0;
    for (const chunk of this.chunksSpanning(x, reach)) {
      for (const solid of chunk.solids) {
        if (solid.x + solid.width / 2 < x - reach || solid.x - solid.width / 2 > x + reach) continue;
        this.solidScratch.push(solid);
      }
    }
    return this.solidScratch;
  }

  /** Drops distant resolved chunks and prunes the terrain's own cache. */
  prune(aroundX: number): void {
    const centre = chunkIndexAt(aroundX);
    for (const index of this.resolved.keys()) {
      if (Math.abs(index - centre) > KEEP_RADIUS) this.resolved.delete(index);
    }
    this.terrain.prune(aroundX);
  }

  /** Resolved chunks currently held. Exposed for tests and diagnostics. */
  get residentCount(): number {
    return this.resolved.size;
  }

  private *chunksSpanning(x: number, reach: number): Generator<ResolvedChunk> {
    // Widened by MAX_SPAWN_REACH because an arc anchored in a neighbouring chunk can
    // still reach into this window.
    const first = chunkIndexAt(x - reach - MAX_SPAWN_REACH);
    const last = chunkIndexAt(x + reach + MAX_SPAWN_REACH);
    for (let index = first; index <= last; index++) yield this.chunk(index);
  }

  private chunk(index: number): ResolvedChunk {
    const cached = this.resolved.get(index);
    if (cached) return cached;

    // Specs owned by this chunk, regardless of where their anchor landed. Neighbours are
    // resolved in their own turn.
    const resolved: ResolvedChunk = { chimes: [], obstacles: [], solids: [] };
    for (const spec of this.terrain.chunkSpawns(index)) {
      this.resolveInto(resolved, spec, index);
    }

    this.resolved.set(index, resolved);
    return resolved;
  }

  private resolveInto(target: ResolvedChunk, spec: SpawnSpec, index: number): void {
    switch (spec.kind) {
      case 'chimeArc':
        // Suspended: arcs were derived from the runner's auto-cruise/auto-launch model,
        // which the platformer pivot removed (see player.ts). Re-derived in a later
        // milestone against real player-controlled movement — see the pivot plan.
        break;
      case 'obstacle': {
        // Rejected on uphill ground — see resolveObstacle. Not every spec becomes
        // an entity, the same as a ledge with nowhere sensible to sit.
        const obstacle = resolveObstacle(this.terrain, spec, index);
        if (obstacle) target.obstacles.push(obstacle);
        break;
      }
      case 'ledge':
        target.solids.push(resolveLedge(this.terrain, spec, index));
        break;
    }
  }
}
