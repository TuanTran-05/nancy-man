# Course-Closing Stored DOCX Viewer Design

## Context

Course-closing evaluation and tuition documents are already generated as canonical DOCX
artifacts and stored in Cloud Storage. The current archive preview downloads the DOCX bytes
through an authenticated API and renders them in the browser with `docx-preview`. That
client-side renderer does not reproduce Microsoft Word layout reliably: floating logos may
collapse, fonts can differ, table borders and pagination can drift, and the browser output is
not the stored file's native Office rendering.

The Knowledge Bank already uses the desired interaction model. It requests a short-lived
signed URL for the stored file, embeds DOCX files through Microsoft Office Viewer, and requests
a separate attachment URL when the user downloads the file.

## Goal

Make the course-closing archive view and download the canonical DOCX already stored in Cloud
Storage, using the same Microsoft Office Viewer pattern as the Knowledge Bank and never
regenerating or rendering the document on the client.

## Non-Goals

- Rebuilding an evaluation or tuition DOCX when the user clicks View or Download.
- Generating HTML, PDF, images, or another preview artifact.
- Editing DOCX content in the browser.
- Creating a self-hosted Office rendering service.
- Deleting legacy `.preview.html` objects that may already exist in Storage.
- Changing the canonical course-closing DOCX templates or generator version.

## Selected Approach

Reuse the existing authenticated `course-closing-record-file` endpoint and
`getKnowledgeDocumentViewerUrl` helper.

For View, the client requests the endpoint with `mode=inline`, receives the signed canonical
Storage URL, URL-encodes it into the Microsoft Office Viewer embed URL, and places that viewer
URL in an iframe.

For Download, the client requests the same endpoint with `mode=attachment` and activates a
temporary anchor pointing to the returned signed URL. Storage's response disposition and the
returned `downloadFilename` preserve a DOCX download rather than a generated derivative.

## Alternatives Considered

### Direct signed DOCX URL in an iframe

Browsers do not consistently display DOCX files. Depending on browser and operating system,
the file may download, open an external application, or show an empty frame. This does not
provide a dependable in-app View action.

### Keep `docx-preview`

This avoids sending the signed URL to an external viewer but cannot reproduce the source Word
layout closely enough for the fixed template. It is the source of the missing logo, font, and
border discrepancies and is removed.

### Self-host OnlyOffice or Collabora

A self-hosted viewer offers more control and avoids Microsoft Office Viewer, but it introduces
a new stateful deployment, document access integration, font management, monitoring, and
operational cost. That infrastructure is outside the current application and is unnecessary
because the Knowledge Bank already establishes the accepted Office Viewer pattern.

## Architecture

### Canonical Storage artifact

The DOCX at `evaluationDocument.storagePath` or `tuitionDocument.storagePath` remains the
single source of truth. Materialization continues to save only this DOCX. The client does not
receive or use `previewStoragePath`, and no preview artifact is created.

### Signed file endpoint

`handleCourseClosingRecordFile` remains the only course-closing document-read handler. It:

1. Allows only admin, office, and accounting roles.
2. Rejects accounting access to evaluation documents.
3. Validates `recordId`, `documentType`, and `mode`.
4. Verifies that the canonical artifact is ready and its Storage object exists.
5. Returns `409` without queuing or running materialization when that stored object is
   unavailable.
6. Writes the required export audit record, including document type, mode, and canonical
   storage path.
7. Returns a V4 signed read URL with a ten-minute expiry.
8. Uses inline response disposition for View and attachment response disposition for Download.
9. Returns `url`, `downloadFilename`, and `expiresAt` as JSON.

The redundant `course-closing-record-preview` binary route and
`handleCourseClosingRecordPreview` handler are removed. The classes router applies the existing
course-closing file rate limit only to `course-closing-record-file`.

### Client data boundary

The course-closing query module defines the signed-file response and one request function:

```ts
type CourseClosingDocumentType = 'evaluation' | 'tuition';
type CourseClosingDocumentMode = 'inline' | 'attachment';

interface CourseClosingRecordFileResponse {
  success: true;
  url: string;
  downloadFilename: string;
  expiresAt: string;
}

function fetchCourseClosingRecordFile(
  recordId: string,
  documentType: CourseClosingDocumentType,
  mode: CourseClosingDocumentMode
): Promise<CourseClosingRecordFileResponse>;
```

The preview query calls this function with `mode=inline`, is disabled until both identifiers
exist, does not retry automatically, and uses the existing five-minute stale time. All query
parameters are built with `URLSearchParams`.

The generic `apiBinaryRequest` helper is removed because no remaining caller needs it.

### Viewer modal

The page transforms the inline signed URL with:

```ts
getKnowledgeDocumentViewerUrl('docx', response.url)
```

The modal receives that viewer URL and renders a full-height iframe after the request
succeeds. Loading, preview error, retry, accessible close, scroll locking, title construction,
and responsive sizing remain.

The modal header also contains a Download button. On click, the page requests a fresh
`mode=attachment` URL, creates a hidden anchor with the signed URL and
`downloadFilename`, activates it, and removes it. The button is disabled and reports a loading
state while the request is in progress. A download failure is displayed inside the modal
without replacing a successfully loaded viewer.

The dedicated `CourseClosingDocxRenderer` component and its tests are deleted, and the
`docx-preview` package is removed from dependencies and the lockfile.

### Security and privacy

Authorization, accounting restrictions, Storage-existence checks, and audit logging remain
server-side. Storage paths are not exposed as public URLs. The browser receives only a
short-lived signed URL after authorization.

Microsoft Office Viewer must fetch the document through that temporary signed URL. This
shares the document with Microsoft for rendering and matches the application's existing
Knowledge Bank behavior approved for this feature.

### Error handling

- Invalid input returns `400`.
- Unauthorized role or accounting evaluation access returns `403`.
- Missing records return `404`.
- A missing/not-ready artifact or missing Storage object returns `409` without queuing or
  running materialization.
- Generator metadata is not a read-time gate: if the ready stored DOCX exists, the endpoint
  serves it as-is.
- A signed-URL request error uses the server's JSON error message through `apiRequest`.
- Preview errors retain the current Retry action.
- Download errors leave the viewer open and expose a localized alert.
- Repeated Download clicks are ignored while one attachment request is active.

## Testing Strategy

Implementation follows red-green-refactor:

1. Query tests prove that View requests `course-closing-record-file` with `mode=inline`, Download
   requests the same endpoint with `mode=attachment`, identifiers are URL-encoded, and an
   incomplete selection makes no request.
2. Modal tests prove that a valid viewer URL is assigned to the iframe, loading/error/retry/
   close behavior remains accessible, and Download exposes disabled/loading and error states.
3. Page tests prove that selecting a ready document requests the inline signed URL, embeds the
   encoded Microsoft Office Viewer URL, and clicking Download requests a fresh attachment URL
   and activates a DOCX link with the server filename.
4. Router tests prove that only `course-closing-record-file` is routed and rate-limited as the
   document-read action.
5. Handler tests retain coverage for signed inline and attachment URLs, role restrictions,
   read-only missing-file behavior, no generator-metadata check, and audit metadata. Obsolete
   binary-preview tests are removed.
6. API client tests are updated after removing the now-unused binary helper.
7. Run the focused course-closing and viewer tests, formatting, typecheck, the full Vitest
   suite, and the production build.

## Acceptance Criteria

- Clicking View requests the canonical stored DOCX through
  `course-closing-record-file?mode=inline`.
- The modal embeds Microsoft Office Viewer with the returned signed URL encoded as its source.
- The browser never renders DOCX bytes with `docx-preview`.
- Clicking Download requests `mode=attachment` and downloads the canonical DOCX using the
  server-provided filename.
- No View or Download action regenerates the document or creates HTML/PDF preview artifacts.
- Existing authorization, accounting restrictions, rate limiting, audit logging, loading,
  retry, and close behavior remain covered.
- A View or Download request never calls the course-closing materializer or creates an outbox
  repair job.
- `course-closing-record-preview`, `apiBinaryRequest`, `CourseClosingDocxRenderer`, and the
  `docx-preview` dependency have no remaining production use.
- Formatting, typecheck, focused tests, full unit tests, and production build complete
  successfully before the changes are pushed to `main`.
