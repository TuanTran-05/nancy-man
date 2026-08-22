import { describe, expect, it, vi } from 'vitest';
import { decodeStudentAdminReportResponse } from './studentAdminReportApi';

/**
 * The adapter that carries canonical identity from the server to the page.
 *
 * A report opened by a link written before a merge is answered for the
 * surviving profile, and the response says so through `redirected` plus the id
 * it actually opened. If `redirected` arrives without that id, the page has no
 * way to correct the address bar and the stale link stays a bookmark and a
 * shared link that outlive the merge. Passing that through unchecked is how a
 * retired id keeps circulating.
 */
const baseResponse = {
  student: { id: 'canonical-1', name: 'QUÁCH HOÀNG MINH' },
  timeline: [],
  attendanceRows: [],
  sessionValueByTerm: {},
  ledgers: [],
  receipts: [],
  truncation: { attendance: false, ledgers: false, classSessions: false },
  generatedAt: '2026-08-10T00:00:00.000Z',
};

describe('decodeStudentAdminReportResponse', () => {
  it('keeps the canonical redirect metadata the page navigates with', () => {
    const decoded = decodeStudentAdminReportResponse({
      ...baseResponse,
      canonicalProfileId: 'canonical-1',
      requestedProfileId: 'legacy-1',
      redirected: true,
    });

    expect(decoded).toMatchObject({
      canonicalProfileId: 'canonical-1',
      requestedProfileId: 'legacy-1',
      redirected: true,
    });
  });

  it('rejects a redirect that does not say what it redirected to', () => {
    expect(() => decodeStudentAdminReportResponse({ ...baseResponse, redirected: true })).toThrow(
      'STUDENT_ADMIN_REPORT_REDIRECT_WITHOUT_CANONICAL_ID'
    );

    expect(() =>
      decodeStudentAdminReportResponse({
        ...baseResponse,
        redirected: true,
        canonicalProfileId: '   ',
      })
    ).toThrow('STUDENT_ADMIN_REPORT_REDIRECT_WITHOUT_CANONICAL_ID');
  });

  it('passes a legacy_compare response through unchanged', () => {
    // The server does not send the canonical fields in every mode, and a
    // decoder that demanded them would break the surface it is protecting.
    expect(decodeStudentAdminReportResponse(baseResponse)).toEqual(baseResponse);
  });
});

describe('fetchStudentAdminReport', () => {
  it('decodes what the channel returned', async () => {
    vi.resetModules();
    vi.doMock('./readApi', () => ({
      readChannel: vi.fn().mockResolvedValue({ ...baseResponse, redirected: true }),
    }));

    const module = await import('./studentAdminReportApi');
    await expect(module.fetchStudentAdminReport({ studentId: 'legacy-1' })).rejects.toThrow(
      'STUDENT_ADMIN_REPORT_REDIRECT_WITHOUT_CANONICAL_ID'
    );
    vi.doUnmock('./readApi');
  });
});
