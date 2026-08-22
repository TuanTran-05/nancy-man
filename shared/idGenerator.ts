export function generateNextStudentId(existingIds: string[], now = new Date()): string {
  const currentYear = now.getFullYear().toString().slice(-2);
  const prefix = `HS${currentYear}`;

  let maxSeq = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function isValidStudentId(id: string): boolean {
  return /^HS\d{2}\d{4}$/.test(id);
}

export function isValidTeacherId(id: string): boolean {
  return /^GV\d{4}$/.test(id);
}

export function generateNextClassId(
  existingIds: string[],
  levelName: string,
  now = new Date()
): string {
  const prefixStr = (levelName || 'CLASS').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const currentYear = now.getFullYear().toString().slice(-2);
  const prefix = `${prefixStr}-${currentYear}-`;

  let maxSeq = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return `${prefix}${String(maxSeq + 1).padStart(2, '0')}`;
}

export function isValidClassId(id: string): boolean {
  return /^[A-Z0-9]+-\d{2}-\d{2}$/.test(id);
}

export function generateNextTeacherId(existingIds: string[]): string {
  const prefix = 'GV';
  let maxSeq = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}
