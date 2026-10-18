import type { Interactable, Vec2 } from "@/types/game";

/**
 * Decides which object, if any, the USE button would act on right now.
 *
 * Pure game logic: it only compares positions. What actually happens on use
 * (show a message, pick up a key, open a door) is decided by the caller, so
 * objects can change behaviour without touching this system or the renderer.
 */
export class InteractionSystem {
  private readonly items: Interactable[];
  private readonly disabled = new Set<string>();
  private focusedItem: Interactable | null = null;

  constructor(items: Interactable[]) {
    this.items = items;
  }

  /** The object in reach that USE would act on, or null. */
  get focused(): Interactable | null {
    return this.focusedItem;
  }

  /** Remove an object from consideration (e.g. after picking it up), or restore it. */
  setEnabled(id: string, enabled: boolean) {
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
  }

  /**
   * Re-pick the nearest object within reach of `position`.
   * Returns true when the focused object changed, so the HUD only re-renders then.
   */
  update(position: Vec2): boolean {
    let best: Interactable | null = null;
    let bestDistance = Infinity;

    for (const item of this.items) {
      if (this.disabled.has(item.id)) continue;
      const distance = Math.hypot(item.position.x - position.x, item.position.z - position.z);
      if (distance <= item.reach && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }

    if (best === this.focusedItem) return false;
    this.focusedItem = best;
    return true;
  }
}
