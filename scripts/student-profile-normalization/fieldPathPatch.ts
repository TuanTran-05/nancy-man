function cloneContainer(value: unknown, nextSegment: string): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return [...value];
  if (typeof value === 'object' && value !== null) return { ...(value as Record<string, unknown>) };
  return /^\d+$/.test(nextSegment) ? [] : {};
}

function segmentsFor(fieldPath: string): string[] {
  const segments = fieldPath.split('.');
  if (segments.some((segment) => segment === '') || segments[0] === '__documentId__') {
    throw new Error(`STUDENT_PROFILE_FINAL_AUDIT_UNWRITABLE_FIELD_PATH:${fieldPath}`);
  }
  return segments;
}

export function readFieldPathValue(
  source: Record<string, unknown>,
  fieldPath: string
): { exists: boolean; restorePath: string; value?: unknown } {
  const segments = segmentsFor(fieldPath);
  let cursor: unknown = source;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const pathHere = segments.slice(0, index + 1).join('.');
    if (Array.isArray(cursor) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (!Object.prototype.hasOwnProperty.call(cursor, index)) {
        return { exists: false, restorePath: pathHere };
      }
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) {
      // The forward patch replaces this scalar/non-matching container in
      // order to descend further. Restoring a missing child would leave the
      // replacement container behind; the value at the last valid prefix is
      // the real before-image.
      return {
        exists: true,
        restorePath: segments.slice(0, index).join('.'),
        value: cursor,
      };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { exists: false, restorePath: pathHere };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { exists: true, restorePath: fieldPath, value: cursor };
}

/** Materialises the inventory's dotted paths into a whole document. */
export function applyFieldPathPatch(
  source: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  let result: Record<string, unknown> = { ...source };

  for (const [fieldPath, value] of Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))) {
    const segments = segmentsFor(fieldPath);

    const root = cloneContainer(result, segments[0]) as Record<string, unknown>;
    result = root;
    let cursor: Record<string, unknown> | unknown[] = root;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;
      const key: string | number = Array.isArray(cursor) && /^\d+$/.test(segment)
        ? Number(segment)
        : segment;

      if (isLast) {
        (cursor as Record<string | number, unknown>)[key] = value;
        break;
      }

      const existing = (cursor as Record<string | number, unknown>)[key];
      const child = cloneContainer(existing, segments[index + 1]);
      (cursor as Record<string | number, unknown>)[key] = child;
      cursor = child;
    }
  }

  return result;
}

/** Restores only the fields named by a forward patch, preserving every other field. */
export function restoreFieldPathPatch(
  source: Record<string, unknown>,
  beforeValues: Record<string, unknown>,
  absentFieldPaths: readonly string[]
): Record<string, unknown> {
  let result = applyFieldPathPatch(source, beforeValues);

  for (const fieldPath of [...absentFieldPaths].sort()) {
    const segments = segmentsFor(fieldPath);
    const root = cloneContainer(result, segments[0]) as Record<string, unknown>;
    result = root;
    let cursor: Record<string, unknown> | unknown[] = root;

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;
      const numeric = Array.isArray(cursor) && /^\d+$/.test(segment);
      const key: string | number = numeric ? Number(segment) : segment;

      if (isLast) {
        if (numeric) {
          throw new Error(
            `STUDENT_PROFILE_ROLLBACK_ARRAY_ELEMENT_ABSENCE_UNSUPPORTED:${fieldPath}`
          );
        }
        delete (cursor as Record<string, unknown>)[String(key)];
        break;
      }

      const existing = (cursor as Record<string | number, unknown>)[key];
      if (existing === undefined || existing === null || typeof existing !== 'object') break;
      const child = cloneContainer(existing, segments[index + 1]);
      (cursor as Record<string | number, unknown>)[key] = child;
      cursor = child;
    }
  }

  return result;
}
