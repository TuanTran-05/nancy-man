# Course-Closing DOCX Preview Fidelity Design

## Context

The course-closing records page currently presents a stored Word document by converting the
DOCX to HTML with Mammoth, storing that HTML as a second artifact, and loading it into a
sandboxed iframe. This preserves text, the embedded logo, and basic table spans, but it drops
the template's fixed table grid, row heights, cell borders, vertical alignment, paragraph
formatting, and exact page margins. The wrapper then applies a generic 20 mm page padding and
explicitly removes cell borders, so the preview cannot resemble the source Word template.

The authoritative evaluation template is A4 portrait with 0.5-inch margins and a fixed
20-row, 10-column table. The runtime template preserves those page and table measurements.
The defect is therefore in the preview conversion path, not in the DOCX generator.

## Goal

Render the canonical stored course-closing DOCX directly in the browser so the preview
preserves the source template's page size, margins, fonts, table geometry, borders, merged
cells, image placement, and page breaks as closely as a browser renderer permits.

## Non-Goals

- Pixel-identical Microsoft Word rendering.
- Introducing an external DOCX-to-PDF service or a new deployment target.
- Regenerating existing canonical DOCX artifacts.
- Deleting already stored `.preview.html` objects as part of this change.
- Turning the preview into an editor.

## Considered Approaches

### 1. Client-side DOCX rendering with `docx-preview` — selected

The authorized API streams the canonical DOCX bytes. The client lazily loads
`docx-preview` and renders the bytes into a dedicated preview container.

Advantages:

- Retains OOXML page, font, table, border, image, and page-break information that Mammoth
  intentionally discards.
- Requires no Word, LibreOffice, Gotenberg, or other conversion service in Vercel.
- Keeps the canonical DOCX as the single source of truth.
- Avoids storing and repairing a redundant HTML artifact.

Trade-offs:

- Browser HTML layout is still not pixel-identical to Microsoft Word.
- Adds one client dependency and a lazy-loaded preview chunk.
- Pagination can differ for documents that rely on Word's live layout calculations. The
  current templates are fixed one-page table forms, which limits this risk.

### 2. External DOCX-to-PDF renderer

Generate and store a PDF beside each DOCX, then display the PDF.

This gives the highest rendering consistency, but the current Vercel architecture has no
office renderer. It would require a separately deployed conversion service, font management,
credentials, monitoring, and failure recovery. This remains a future option if browser
fidelity proves insufficient.

### 3. Hand-authored HTML/CSS replica

Recreate each Word template as a separate HTML template.

This avoids a rendering dependency but duplicates every layout measurement and creates
permanent drift whenever the DOCX template changes. It is not selected.

## Architecture

### Canonical document endpoint

`handleCourseClosingRecordPreview` keeps its existing route, role checks, accounting
restriction, canonical-artifact inspection, repair behavior, and audit logging. After those
checks it downloads the canonical DOCX from Storage and responds with the binary document:

- `Content-Type` is the WordprocessingML DOCX MIME type.
- `Content-Disposition` is `inline` with the stored download filename.
- `Cache-Control` is private and short-lived.
- The response body is the canonical DOCX buffer.

The endpoint never exposes an unsigned storage path. It continues to proxy the bytes through
the authenticated API so bucket CORS and signed-URL leakage are not introduced.

### Client query

The course-closing query module gains a small authenticated binary request helper. It uses the
same Firebase bearer-token behavior as the JSON API client, checks `response.ok`, converts
JSON error envelopes into `Error` objects, and returns an `ArrayBuffer` for successful DOCX
responses.

The React Query key, enablement rules, retry policy, stale time, and immediate garbage
collection remain unchanged. The page already owns the student name and document type, so the
binary response does not need a JSON metadata envelope.

### DOCX renderer

A focused `CourseClosingDocxRenderer` component owns the DOM renderer lifecycle:

1. Clear the previous rendered document when the buffer changes.
2. Lazy-import `docx-preview`.
3. Call `renderAsync` with page width, page height, fonts, headers, footers, and page breaks
   enabled.
4. Disable altChunk HTML, comments, and tracked-change rendering because course-closing
   documents are generated from trusted static templates and do not require those features.
5. Use base64 resource URLs so image object URLs do not survive modal closure.
6. Ignore a late render completion after the component unmounts or receives a newer buffer.

The renderer displays an internal progress state until the document is ready. A render error
uses the existing localized error and retry presentation. Retry clears the target and starts
the renderer again with the same buffer; the outer API retry remains available for transport
errors.

The modal keeps its current dialog shell, title, close behavior, scroll lock, and responsive
height. The iframe and `srcDoc` prop are replaced by the renderer. The preview viewport uses a
neutral gray canvas and scrolls around the rendered A4 page without overriding document table
or paragraph styles.

## Materialization and Stored Data

New materializations save only the canonical DOCX. They no longer run Mammoth, save a
`.preview.html` object, or write `previewStoragePath`.

Existing records may still contain `previewStoragePath`, and existing HTML objects may remain
in Storage. The field stays optional in the shared persisted type for backward compatibility,
but the new preview path ignores it. Removing old objects is a separate administrative cleanup
and is deliberately outside this change.

`courseClosingPreviewStoragePath` and the preview HTML MIME constant become unused production
APIs and are removed together with their obsolete tests. Mammoth remains a project dependency
because assignment import and DOCX text-extraction tests still use it.

The document generator version does not change: the canonical DOCX format is unchanged, and
forcing regeneration would add cost without improving the preview.

## Security

- Existing role and document-type authorization stays server-side.
- Accounting users remain forbidden from evaluation documents.
- The client receives only the already-authorized canonical DOCX.
- `renderAltChunks` is disabled so embedded arbitrary HTML is not rendered.
- No third-party viewer receives student documents.
- The endpoint continues to write the required export audit log with `mode: "preview"` and the
  canonical `storagePath`; obsolete preview-path metadata is omitted.

## Error Handling

- Invalid identifiers and document types remain `400`.
- Unauthorized document access remains `403`.
- Missing records remain `404`.
- Canonical repair states keep the existing pending response.
- Storage download failures follow the API's existing error boundary.
- Non-success binary requests surface the server error message when the response is JSON.
- Renderer failures show the localized preview error and an in-place retry action.
- Closing the modal during a render prevents stale completion from updating the next preview.

## Testing

Implementation follows red-green-refactor:

1. Handler tests first assert that an authorized preview returns the exact DOCX buffer with
   Word MIME headers, preserves all existing authorization and repair behavior, and logs the
   canonical preview audit.
2. Materializer tests first assert that only the DOCX artifact is saved and no preview HTML
   path is written.
3. Query tests first assert authenticated binary fetching, error-envelope handling, query
   enablement, and cache settings.
4. Renderer tests first assert `renderAsync` receives the document buffer and fidelity/safety
   options, clears stale content, handles rejected renders, retries, and ignores stale
   completions.
5. Modal/page tests first assert that DOCX bytes, rather than HTML, reach the renderer while
   loading, transport error, close, and retry behavior remains intact.
6. Run the focused Vitest files, then formatting, typecheck, the full unit suite, and the
   production build.

## Acceptance Criteria

- Evaluation and tuition previews render from the canonical stored DOCX, not Mammoth HTML.
- The evaluation preview visibly retains the source A4 page, 0.5-inch margins, fixed table
  geometry, cell borders, merged cells, centered content, and logo placement.
- No new `.preview.html` artifact is created.
- Existing role restrictions, canonical repair behavior, audit logging, loading, retry, and
  close behavior continue to work.
- The preview does not send documents to a third-party service.
- Existing download behavior remains unchanged.

