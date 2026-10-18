import type { ItemDefinition } from "@/types/game";

/**
 * The player's inventory as an immutable list. Pure functions: each returns a
 * new list and never changes the one passed in.
 */
export type Inventory = readonly ItemDefinition[];

export const MAX_INVENTORY_SLOTS = 3;

export function hasItem(inventory: Inventory, itemId: string): boolean {
  return inventory.some((item) => item.id === itemId);
}

/** Add an item. Holding the same item twice is not allowed, nor going past the slot limit. */
export function addItem(inventory: Inventory, item: ItemDefinition): Inventory {
  if (hasItem(inventory, item.id) || inventory.length >= MAX_INVENTORY_SLOTS) return inventory;
  return [...inventory, item];
}

/** Remove an item (e.g. a key used up by a door). Unknown ids leave the inventory unchanged. */
export function removeItem(inventory: Inventory, itemId: string): Inventory {
  return hasItem(inventory, itemId) ? inventory.filter((item) => item.id !== itemId) : inventory;
}
