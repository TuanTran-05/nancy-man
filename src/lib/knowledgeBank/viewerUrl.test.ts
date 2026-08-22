import { describe, expect, it } from 'vitest';

import { getKnowledgeDocumentViewerUrl } from './viewerUrl';

describe('getKnowledgeDocumentViewerUrl', () => {
  it('keeps PDF preview URLs direct', () => {
    const signedUrl = 'https://storage.example.com/file.pdf?token=abc';

    expect(getKnowledgeDocumentViewerUrl('pdf', signedUrl)).toBe(signedUrl);
  });

  it('uses Microsoft Office Viewer for DOCX preview URLs', () => {
    const signedUrl = 'https://storage.example.com/file.docx?token=a b&expires=123';

    expect(getKnowledgeDocumentViewerUrl('docx', signedUrl)).toBe(
      `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(signedUrl)}`
    );
  });
});
