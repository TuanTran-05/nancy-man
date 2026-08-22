// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ZaloOAStatusPanel } from './ZaloOAStatusPanel';
import { getZaloLogSummary, getZaloStatus, sendZaloTestMessage } from '../../lib/zalo/zaloService';
import toast from 'react-hot-toast';

const documentStoreMockState = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../lib/zalo/zaloService', () => ({
  getZaloLogSummary: vi.fn(),
  getZaloStatus: vi.fn(),
  sendZaloTestMessage: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('lucide-react', () => ({
  Mail: () => null,
  Loader2: () => null,
  RefreshCw: () => null,
}));

const mockedGetZaloStatus = vi.mocked(getZaloStatus);
const mockedGetZaloLogSummary = vi.mocked(getZaloLogSummary);
const mockedSendZaloTestMessage = vi.mocked(sendZaloTestMessage);
const mockedToast = vi.mocked(toast);

describe('ZaloOAStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documentStoreMockState.logs = [];
    mockedGetZaloLogSummary.mockImplementation(async () => ({
      success: true,
      logs: documentStoreMockState.logs as any,
    }));
  });

  it('shows loading state initially', () => {
    mockedGetZaloStatus.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ZaloOAStatusPanel language="en" />);
    expect(screen.getByText('Checking...')).toBeDefined();
  });

  it('shows connected status', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
      oaId: 'OA123',
      expiresIn: 3600,
    });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.getByText(/Connected to Zalo OA/)).toBeDefined();
    });
  });

  it('labels next course tuition Zalo logs as tuition instead of absence', async () => {
    documentStoreMockState.logs = [
      {
        id: 'tuition-log-1',
        studentName: 'T*** S***',
        phoneMasked: '84***314',
        date: '02/06/2026',
        type: 'next_course_tuition',
        status: 'sent',
        createdAt: '2026-05-19T01:00:00.000Z',
      },
    ];
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });

    render(<ZaloOAStatusPanel language="vi" />);

    await waitFor(() => {
      expect(screen.getByText('Học phí')).toBeDefined();
    });
    expect(screen.queryByText('Vắng')).toBeNull();
  });

  it('shows the stored Zalo error for failed send logs', async () => {
    documentStoreMockState.logs = [
      {
        id: 'tuition-log-1',
        studentName: 'T*** S***',
        phoneMasked: '84***314',
        date: '02/06/2026',
        type: 'next_course_tuition',
        status: 'failed',
        errorMessage: 'ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID is not configured',
        createdAt: '2026-05-19T01:00:00.000Z',
      },
    ];
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(
        screen.getByText(/ZALO_ZNS_TUITION_NOTICE_TEMPLATE_ID is not configured/)
      ).toBeDefined();
    });
  });

  it('shows not configured status', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: false,
      configured: false,
    });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.getByText(/Not configured/)).toBeDefined();
    });
  });

  it('test button disabled when phone empty', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.queryByText('Checking...')).toBeNull();
    });

    const buttons = screen.getAllByRole('button');
    // The Test button should be disabled when no phone is entered
    const testButton = buttons.find((b) => b.textContent?.includes('Test'));
    expect(testButton).toBeDefined();
    expect(testButton).toBeDisabled();
  });

  it('test button calls sendZaloTestMessage', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });
    mockedSendZaloTestMessage.mockResolvedValue({ success: true, messageId: 'msg-1' });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.queryByText('Checking...')).toBeNull();
    });

    // Type a phone number
    const input = screen.getByPlaceholderText('Test phone number');
    fireEvent.change(input, { target: { value: '0384072314' } });

    // Click test button
    const buttons = screen.getAllByRole('button');
    const testButton = buttons.find((b) => b.textContent?.includes('Test'));
    expect(testButton).toBeDefined();

    fireEvent.click(testButton!);

    await waitFor(() => {
      expect(mockedSendZaloTestMessage).toHaveBeenCalledWith('0384072314');
    });
  });

  it('shows success toast on test success', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });
    mockedSendZaloTestMessage.mockResolvedValue({ success: true, messageId: 'msg-1' });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.queryByText('Checking...')).toBeNull();
    });

    const input = screen.getByPlaceholderText('Test phone number');
    fireEvent.change(input, { target: { value: '0384072314' } });

    const buttons = screen.getAllByRole('button');
    const testButton = buttons.find((b) => b.textContent?.includes('Test'));
    fireEvent.click(testButton!);

    await waitFor(() => {
      expect(mockedToast.success).toHaveBeenCalledWith('Test message sent!');
    });
  });

  it('shows error toast on test failure', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });
    mockedSendZaloTestMessage.mockResolvedValue({
      success: false,
      error: 'Invalid phone number',
    });

    render(<ZaloOAStatusPanel language="en" />);

    await waitFor(() => {
      expect(screen.queryByText('Checking...')).toBeNull();
    });

    const input = screen.getByPlaceholderText('Test phone number');
    fireEvent.change(input, { target: { value: '0384072314' } });

    const buttons = screen.getAllByRole('button');
    const testButton = buttons.find((b) => b.textContent?.includes('Test'));
    fireEvent.click(testButton!);

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('Invalid phone number');
    });
  });

  it('renders Vietnamese text when language=vi', async () => {
    mockedGetZaloStatus.mockResolvedValue({
      connected: true,
      configured: true,
    });

    render(<ZaloOAStatusPanel language="vi" />);

    await waitFor(() => {
      expect(screen.getByText(/Đã kết nối Zalo OA/)).toBeDefined();
    });

    // Vietnamese placeholder text for the test input
    expect(screen.getByPlaceholderText(/SĐT test/)).toBeDefined();
  });
});
