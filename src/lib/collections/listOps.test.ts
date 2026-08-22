import { describe, expect, it } from 'vitest';
import { upsertById, removeById, patchById, mergeUniqueById } from './listOps';

describe('listOps helpers', () => {
  interface Item {
    id: string;
    name: string;
    value?: number;
  }

  const initialList: Item[] = [
    { id: '1', name: 'Alice' },
    { id: '2', name: 'Bob' },
    { id: '3', name: 'Charlie' },
  ];

  describe('upsertById', () => {
    it('updates an existing item without changing order', () => {
      const updated = { id: '2', name: 'Robert' };
      const next = upsertById(initialList, updated);
      expect(next).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Robert' },
        { id: '3', name: 'Charlie' },
      ]);
    });

    it('appends a new item to the end', () => {
      const newItem = { id: '4', name: 'David' };
      const next = upsertById(initialList, newItem);
      expect(next).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '3', name: 'Charlie' },
        { id: '4', name: 'David' },
      ]);
    });
  });

  describe('removeById', () => {
    it('removes an item by id', () => {
      const next = removeById(initialList, '2');
      expect(next).toEqual([
        { id: '1', name: 'Alice' },
        { id: '3', name: 'Charlie' },
      ]);
    });

    it('returns the same list if id is not found', () => {
      const next = removeById(initialList, '99');
      expect(next).toEqual(initialList);
    });
  });

  describe('patchById', () => {
    it('patches an existing item without changing order', () => {
      const next = patchById(initialList, '2', { name: 'Bob-patched', value: 10 });
      expect(next).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob-patched', value: 10 },
        { id: '3', name: 'Charlie' },
      ]);
    });

    it('does nothing if id is not found', () => {
      const next = patchById(initialList, '99', { name: 'None' });
      expect(next).toEqual(initialList);
    });
  });

  describe('mergeUniqueById', () => {
    it('merges new items and updates existing items in place', () => {
      const incoming: Item[] = [
        { id: '2', name: 'Bob-updated' },
        { id: '4', name: 'David' },
      ];
      const next = mergeUniqueById(initialList, incoming);
      expect(next).toEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob-updated' },
        { id: '3', name: 'Charlie' },
        { id: '4', name: 'David' },
      ]);
    });
  });
});
