import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('token-123') } },
}));

import { fetchWalletBalances } from './financeApi';

/**
 * The wallet list, as the client receives it.
 *
 * This is the split-money half of the duplicate-profile incident: two rows for
 * one child is a debt chased twice and a credit nobody can find. The server
 * returns one row per canonical profile now, and the adapter's whole job is
 * not to undo that — not by collapsing rows, and not by deriving a second one
 * from the deprecated status fields that still travel beside `placementStatus`.
 */
const walletResponse = {
  students: [
    {
      id: 'canonical-1',
      name: 'QUÁCH HOÀNG MINH',
      code: 'HS260167',
      classId: 'class-g7',
      className: 'G7',
      // Deliberately contradictory: the deprecated projection still says the
      // student was promoted out of the old class.
      enrollmentStatus: 'promoted',
      placementStatus: 'studying',
      walletBalance: 1_250_000,
    },
    {
      id: 'canonical-2',
      name: 'BÙI AN',
      code: 'HS260168',
      classId: 'class-g7',
      className: 'G7',
      placementStatus: 'waiting_for_placement',
      walletBalance: 0,
    },
  ],
};

function serve(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, ...(payload as object) }),
    })
  );
}

afterEach(() => vi.restoreAllMocks());

describe('fetchWalletBalances', () => {
  it('returns one row per canonical profile, exactly as served', async () => {
    serve(walletResponse);

    const result = await fetchWalletBalances();

    expect(result.students.map((student) => student.id)).toEqual(['canonical-1', 'canonical-2']);
  });

  it('keeps placement status beside the deprecated field without splitting the row', async () => {
    // `enrollmentStatus: 'promoted'` is the projection that made the wallet
    // show an extra waiting row for a child who was already in G7. It travels
    // through untouched; nothing derives a second row from it.
    serve(walletResponse);

    const result = await fetchWalletBalances();

    expect(result.students.filter((student) => student.code === 'HS260167')).toHaveLength(1);
    expect(result.students[0]).toMatchObject({
      placementStatus: 'studying',
      enrollmentStatus: 'promoted',
      className: 'G7',
      walletBalance: 1_250_000,
    });
  });

  it('carries a waiting-for-placement row without inventing a class for it', async () => {
    serve(walletResponse);

    const result = await fetchWalletBalances();

    expect(result.students[1]).toMatchObject({
      placementStatus: 'waiting_for_placement',
      walletBalance: 0,
    });
  });
});
