// Moves the item with the given id one step up or down.
// Returns the new array, or null when the move is out of range.
export function moveItem<T>(items: T[], id: number, direction: -1 | 1, getId: (item: T) => number): T[] | null {
  const index = items.findIndex((item) => getId(item) === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return null;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}
