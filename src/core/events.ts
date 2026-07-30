/**
 * A tiny typed event bus.
 *
 * This exists so twists can react to the game without reaching into it. A twist
 * that needs to know when the player lands subscribes to `player:land` rather
 * than being wired into the player module — which keeps ~20 twists from turning
 * the player into a switchboard.
 */

export type EventMap = Record<string, unknown>;

export type Listener<Payload> = (payload: Payload) => void;

type ErasedListener = (payload: unknown) => void;

export class EventBus<Events extends EventMap> {
  private readonly listeners = new Map<keyof Events, Set<ErasedListener>>();

  /** Subscribes. Returns an unsubscribe function. */
  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const erased = listener as ErasedListener;
    set.add(erased);
    return () => {
      set?.delete(erased);
    };
  }

  /** Subscribes for a single delivery. */
  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener as ErasedListener);
  }

  /**
   * Delivers to every current subscriber. Iterates a copy, so a listener may
   * safely subscribe or unsubscribe during delivery — which twists do when they
   * expire mid-frame.
   */
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      listener(payload as unknown);
    }
  }

  /** Drops listeners for one event type, or all of them. */
  clear<K extends keyof Events>(type?: K): void {
    if (type === undefined) this.listeners.clear();
    else this.listeners.delete(type);
  }

  count<K extends keyof Events>(type: K): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
