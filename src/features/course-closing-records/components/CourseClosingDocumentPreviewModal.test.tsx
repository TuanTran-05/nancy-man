// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseClosingDocumentPreviewModal } from './CourseClosingDocumentPreviewModal.js';

describe('CourseClosingDocumentPreviewModal', () => {
  beforeEach(() => {
    localStorage.setItem('language', 'en');
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('embeds the supplied Office Viewer URL instead of rendering DOCX bytes', () => {
    const viewerUrl =
      'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fstorage.test%2Ffile.docx';

    render(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="evaluation"
        viewerUrl={viewerUrl}
        isLoading={false}
        isDownloading={false}
        onRetry={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTitle('Evaluation document for Student One')).toHaveAttribute(
      'src',
      viewerUrl
    );
  });

  it('shows a retry action after a preview error', async () => {
    const onRetry = vi.fn();
    render(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="tuition"
        isLoading={false}
        isDownloading={false}
        error="Preview unavailable"
        onRetry={onRetry}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders a loading state and closes accessibly', async () => {
    const onClose = vi.fn();
    render(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="evaluation"
        isLoading
        isDownloading={false}
        onRetry={vi.fn()}
        onDownload={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading document preview');
    await userEvent.click(screen.getByRole('button', { name: 'Close document preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts the DOCX download and exposes its busy state', async () => {
    const onDownload = vi.fn();
    const { rerender } = render(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="tuition"
        viewerUrl="https://view.officeapps.live.com/op/embed.aspx?src=signed"
        isLoading={false}
        isDownloading={false}
        onRetry={vi.fn()}
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Download DOCX' }));
    expect(onDownload).toHaveBeenCalledTimes(1);

    rerender(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="tuition"
        viewerUrl="https://view.officeapps.live.com/op/embed.aspx?src=signed"
        isLoading={false}
        isDownloading
        onRetry={vi.fn()}
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Downloading DOCX…' })).toBeDisabled();
  });

  it('keeps the viewer open when download fails', () => {
    render(
      <CourseClosingDocumentPreviewModal
        studentName="Student One"
        documentType="evaluation"
        viewerUrl="https://view.officeapps.live.com/op/embed.aspx?src=signed"
        isLoading={false}
        isDownloading={false}
        downloadError="Could not download the DOCX."
        onRetry={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not download the DOCX.');
    expect(screen.getByTitle('Evaluation document for Student One')).toBeInTheDocument();
  });
});
