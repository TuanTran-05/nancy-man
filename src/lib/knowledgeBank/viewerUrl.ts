const OFFICE_VIEWER_EMBED_URL = 'https://view.officeapps.live.com/op/embed.aspx?src=';

export function getKnowledgeDocumentViewerUrl(fileType: string | undefined, signedUrl: string) {
  if (fileType === 'docx') {
    return `${OFFICE_VIEWER_EMBED_URL}${encodeURIComponent(signedUrl)}`;
  }

  return signedUrl;
}
