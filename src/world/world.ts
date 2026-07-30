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
import { buildArc, type Chime } from './chimes';
import { resolveObstacle, type Obstacle } from './obstacles';
import { resolveRail, type Rail } from './rails';

interface ResolvedChunk {
  chimes: Chime[];
  obstacles: Obstacle[];
  rails: Rail[];
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
  private readonly railScratch: Rail[] = [];

  constructor(rng: Rng) {
    this.terrain = new Terrain(rng, 0);
  }

  /**
   * Range in which hazards are hidden, or null.
   *
   * This exists for the twist system's grace corridor: after a Shift the player needs a
   * moment to read the new rule without dying to something they were not looking at. It
   * lives here rather than in the twist code so obstacles never need to know twists exist.
   */
  private suppression: { from: number; to: number } | null = null;

  /** Clears per-run state. Terrain and spawn specs are seed-derived and unaffected. */
  reset(): void {
    this.collected.clear();
    this.suppression = null;
  }

  /** Hides hazards between two x positions. Only one range is active at a time. */
  suppressHazards(fromX: number, toX: number): void {
    this.suppression = { from: fromX, to: toX };
  }

  clearHazardSuppression(): void {
    this.suppression = null;
  }

  private isSuppressed(x: number): boolean {
    const range = this.suppression;
    return range !== null && x >= range.from && x <= range.to;
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

  /** Rails overlapping a window. Returns a reused array — iterate immediately. */
  railsNear(x: number, reach = MAX_SPAWN_REACH): readonly Rail[] {
    this.railScratch.length = 0;
    for (const chunk of this.chunksSpanning(x, reach)) {
      for (const rail of chunk.rails) {
        if (rail.x2 < x - reach || rail.x1 > x + reach) continue;
        this.railScratch.push(rail);
      }
    }
    return this.railScratch;
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
    const resolved: ResolvedChunk = { chimes: [], obstacles: [], rails: [] };
    for (const spec of this.terrain.chunkSpawns(index)) {
      this.resolveInto(resolved, spec, index);
    }

    this.resolved.set(index, resolved);
    return resolved;
  }

  private resolveInto(target: ResolvedChunk, spec: SpawnSpec, index: number): void {
    switch (spec.kind) {
      case 'chimeArc':
        target.chimes.push(...buildArc(this.terrain, spec, index));
        break;
      case 'obstacle':
        target.obstacles.push(resolveObstacle(this.terrain, spec, index));
        break;
      case 'rail':
        target.rails.push(resolveRail(this.terrain, spec, index));
        break;
    }
  }
}
