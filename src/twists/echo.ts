/**
 * Echo — a ghost of you from a few seconds ago.
 *
 * The ghost is strictly non-interactive with the player: it cannot block, collide
 * with, or otherwise harm them. Colliding with your own trailing self is an
 * unreadable rule — nothing on screen would tell a player *why* touching a
 * translucent copy of themselves is dangerous — so instead the ghost only ever
 * helps: it retraces your exact line and picks up anything you missed, a second
 * pass at the same run rather than a hazard.
 *
 * History is a fixed-size ring buffer sized in frames, not seconds, which only
 * works because the sim runs a genuinely fixed 60 Hz step (see core/loop.ts) — the
 * "oldest" slot is always exactly `DELAY_SECONDS` behind, with no timestamp
 * bookkeeping needed at all.
 *
 * Collection is routed through the same `collectChime` path a live pickup uses, so
 * the ghost cannot silently diverge from how scoring actually works.
 */

import type { Twist, TwistRuntimeContext } from './types';
import type { SceneBuilder } from '../render/scene';
import type { World } from '../world/world';
import { CHIME_RADIUS, type Chime } from '../world/chimes';
import { PLAYER_RADIUS } from '../player/player';

const DELAY_SECONDS = 3;
const FIXED_DT = 1 / 60;
/**
 * One slot more than `DELAY_SECONDS` of samples.
 *
 * A ring of exactly N slots holds N samples spanning only N-1 frame-gaps between the
 * newest and the oldest — a fencepost: N posts, N-1 gaps. Recording DELAY_SECONDS/DT
 * samples would make the ghost one frame short of the delay it claims. The extra slot
 * makes the newest-to-oldest gap exactly DELAY_SECONDS, not DELAY_SECONDS minus one step.
 */
const BUFFER_LENGTH = Math.round(DELAY_SECONDS / FIXED_DT) + 1;

const GHOST_RADIUS = PLAYER_RADIUS;
/** Same generosity as a live pickup — the ghost rewards the line, not precision. */
const COLLECT_REACH = CHIME_RADIUS + GHOST_RADIUS;

export function createEchoTwist(): Twist {
  const xs = new Float64Array(BUFFER_LENGTH);
  const ys = new Float64Array(BUFFER_LENGTH);
  const rotations = new Float64Array(BUFFER_LENGTH);
  let writeIndex = 0;
  let framesRecorded = 0;

  let world: World | null = null;
  let collectChime: ((chime: Chime) => void) | null = null;
  let player: TwistRuntimeContext['player'] | null = null;

  /**
   * The oldest sample still held — exactly DELAY_SECONDS behind the last recorded frame.
   *
   * `writeIndex` already points at the slot the *next* write will land on, which by
   * construction is the slot holding the current oldest surviving sample (the one about
   * to be overwritten). No further offset is needed — see BUFFER_LENGTH for why one
   * extra slot is what makes this exact rather than one frame short.
   */
  function ghost(): { x: number; y: number; rotation: number } | null {
    if (framesRecorded < BUFFER_LENGTH) return null;
    return {
      x: xs[writeIndex] as number,
      y: ys[writeIndex] as number,
      rotation: rotations[writeIndex] as number,
    };
  }

  return {
    id: 'echo',
    label: 'Echo',
    conflicts: [],

    onActivate(ctx: TwistRuntimeContext): void {
      player = ctx.player;
      world = ctx.world;
      collectChime = ctx.collectChime;
      writeIndex = 0;
      framesRecorded = 0;
    },

    onDeactivate(): void {
      player = null;
      world = null;
      collectChime = null;
    },

    update(): void {
      if (!player) return;

      xs[writeIndex] = player.x;
      ys[writeIndex] = player.y;
      rotations[writeIndex] = player.rotation;
      writeIndex = (writeIndex + 1) % BUFFER_LENGTH;
      framesRecorded = Math.min(framesRecorded + 1, BUFFER_LENGTH);

      const at = ghost();
      if (!at || !world || !collectChime) return;

      for (const chime of world.chimesNear(at.x, COLLECT_REACH * 3)) {
        const dx = chime.x - at.x;
        const dy = chime.y - (at.y - GHOST_RADIUS);
        if (dx * dx + dy * dy <= COLLECT_REACH * COLLECT_REACH) collectChime(chime);
      }
    },

    emit(builder: SceneBuilder): void {
      const at = ghost();
      if (!at) return;

      const cos = Math.cos(at.rotation);
      const sin = Math.sin(at.rotation);
      const halfLength = 17;
      const thickness = 4;
      const corners: ReadonlyArray<readonly [number, number]> = [
        [-halfLength, -thickness],
        [halfLength, -thickness],
        [halfLength, thickness],
        [-halfLength, thickness],
      ];

      builder.polygon('trail', 'entities', 0.4);
      for (const [lx, ly] of corners) {
        builder.point(at.x + lx * cos - ly * sin, at.y + lx * sin + ly * cos);
      }
      builder.end();

      const riderLocalY = -(GHOST_RADIUS + 6);
      builder.disc(
        'trail',
        'entities',
        at.x - riderLocalY * sin,
        at.y + riderLocalY * cos,
        GHOST_RADIUS,
        0.4,
      );
    },
  };
}
