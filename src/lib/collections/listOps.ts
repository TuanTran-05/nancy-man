export function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((x) => x.id === item.id);
  if (index !== -1) {
    const nextItems = [...items];
    nextItems[index] = item;
    return nextItems;
  }
  return [...items, item];
}

export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((x) => x.id !== id);
}

export function patchById<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<T>
): T[] {
  const index = items.findIndex((x) => x.id === id);
  if (index !== -1) {
    const nextItems = [...items];
    nextItems[index] = { ...nextItems[index], ...patch };
    return nextItems;
  }
  return items;
}

export function mergeUniqueById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const nextItems = [...current];
  const currentIds = new Set(current.map((x) => x.id));

  for (const item of incoming) {
    if (currentIds.has(item.id)) {
      const index = nextItems.findIndex((x) => x.id === item.id);
      if (index !== -1) {
        nextItems[index] = item;
      }
    } else {
      nextItems.push(item);
    }
  }

  return nextItems;
}
