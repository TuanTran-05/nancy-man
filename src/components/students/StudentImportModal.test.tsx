// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudentImportModal } from './StudentImportModal';
import { auth } from '../../lib/auth/sessionAuth';

vi.mock('../../lib/auth/sessionAuth', () => ({
  auth: {
    currentUser: {
      uid: 'admin-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerData: [],
    },
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => null,
  Download: () => null,
  FileSpreadsheet: () => null,
  Loader2: () => null,
  Upload: () => null,
  X: () => null,
}));

describe('StudentImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        success: true,
        totalRows: 2,
        created: 1,
        failed: 1,
        createdStudents: [{ row: 2, name: 'Nguyễn Văn A', studentId: 'HS260001' }],
        failures: [
          {
            row: 3,
            name: 'Trần Thị B',
            field: 'Liên hệ',
            error: 'Invalid contact',
          },
        ],
      }),
    } as any);
  });

  it('only accepts xlsx files', () => {
    render(<StudentImportModal open={true} onClose={vi.fn()} />);

    const input = screen.getByLabelText(/Chọn file Excel/i);
    expect(input).toHaveAttribute('accept', '.xlsx');
  });

  it('uploads the selected xlsx file and renders the import result', async () => {
    const onImported = vi.fn();
    render(<StudentImportModal open={true} onClose={vi.fn()} onImported={onImported} />);

    const file = new File(['xlsx'], 'students.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(screen.getByLabelText(/Chọn file Excel/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Nhập học sinh/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/students/import',
        expect.objectContaining({
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: expect.any(FormData),
        })
      );
    });
    const requestBody = vi.mocked(global.fetch).mock.calls[0][1]?.body as FormData;
    expect(requestBody.get('file')).toBe(file);
    expect(onImported).toHaveBeenCalled();
    expect(await screen.findByText(/Thành công: 1/)).toBeDefined();
    expect(screen.getByText(/Thất bại: 1/)).toBeDefined();
    expect(screen.getByText('Trần Thị B')).toBeDefined();
    expect(screen.getByText('Invalid contact')).toBeDefined();
  });
});
