# Course-closing document preview from Storage

Date: 2026-07-26

## Goal

Let authorized staff view the generated course-closing documents inside the application without causing the browser to download a `.docx` file.

The Office send flow remains the source of truth: when Office sends the course-closing notifications, the backend must finish generating and storing the document assets before the corresponding artifact is marked `ready`.

## User experience

- Remove the per-document Download buttons from every student row.
- Keep one Eye button for each ready evaluation or tuition document.
- Clicking a document Eye button opens an in-app document preview modal.
- The preview is read from private Storage through an authenticated API. The browser does not navigate to or download the `.docx` URL.
- Keep the existing final-column Eye button as the lightweight record-summary preview.
- Preserve the current role rules:
  - Admin and Office can preview evaluation and tuition documents.
  - Accounting can preview tuition documents only.
- Pending, retrying, failed, and not-requested artifacts continue to show their status badge instead of an Eye button.

## Storage artifacts

Each materialized document has two private Storage objects:

1. The canonical Word document:
   `.../<documentType>-v<templateVersion>.docx`
2. A browser preview derived from that exact Word buffer:
   `.../<documentType>-v<templateVersion>.preview.html`

The preview HTML is generated with Mammoth from the same in-memory DOCX buffer that is uploaded as the canonical document. A small application-owned stylesheet wraps the extracted body so tables, headings, spacing, and page-like presentation are readable.

Mammoth converts the Word body but not Word headers, footers, watermarks, or
pagination. The browser preview therefore prioritizes readable archival
content rather than pixel-perfect Word rendering; the canonical DOCX remains
the source for those Word-only presentation features. The current embedded
template logo remains a data URI in the HTML for visual fidelity. Its measured
evaluation-preview cost (about 92.6 KB total HTML, including about 89.4 KB for
the logo) is accepted and guarded by a 128 KiB template-preview budget test.

The document artifact stored in Firestore gains an optional `previewStoragePath`. It remains optional at the type level so previously archived records can be migrated lazily.

The materializer performs these operations in order:

1. Render the DOCX.
2. Derive preview HTML from that DOCX buffer.
3. Upload the DOCX with generator-version metadata.
4. Upload the HTML preview with matching generator-version metadata.
5. Update Firestore with both Storage paths and mark the artifact `ready`.

If either upload fails, the artifact is not marked ready. Existing retry and outbox behavior handles another attempt.

## Authenticated preview API

Add a dedicated preview endpoint rather than overloading the signed-file endpoint:

`GET /api/v1/classes/course-closing-record-preview?recordId=<id>&documentType=<evaluation|tuition>`

The endpoint:

1. Verifies the user and applies the existing role restrictions.
2. Loads the archived record and selected artifact.
3. Ensures the canonical DOCX exists and uses the current generator version.
4. Reads the stored preview HTML and returns JSON containing the HTML and document metadata.
5. Writes the required export/view audit log before returning the preview.

The response does not expose a Storage path or signed URL.

The existing file endpoint remains for backward compatibility and operational use, but the course-closing records page no longer calls attachment mode.

## Lazy backfill for existing records

Existing ready records may have a DOCX but no `previewStoragePath`.

On the first preview request, the backend:

1. Validates or repairs a missing/stale canonical DOCX using the current materializer.
2. Downloads the canonical DOCX from private Storage.
3. Generates and uploads the preview HTML.
4. Updates `previewStoragePath`.
5. Returns the newly generated preview in the same request.

This avoids a separate bulk migration and ensures subsequent views read the stored preview directly.

Concurrent first-view requests must use deterministic paths and idempotent updates, so duplicate work does not create duplicate assets.

## Frontend components

### Records table

- `DocumentActions` renders only the Eye button for ready artifacts.
- Its callback becomes a preview callback with `recordId` and `documentType`; it no longer accepts `inline` or `attachment`.
- Remove the `Download` icon import and all per-row attachment calls.

### Document preview modal

Add a modal dedicated to the selected document:

- Shows loading, error, and ready states.
- Displays the returned HTML in an `iframe` using `srcDoc`.
- Uses an empty `sandbox` attribute: scripts, forms, popups, and top-level navigation are not allowed.
- The generated HTML includes a restrictive CSP (`default-src 'none'`; only inline application styling is allowed).
- Closing the modal clears the selected document and its HTML from page state.

The existing record-summary modal remains unchanged.

## Error handling

- `404`: record or canonical document does not exist.
- `403`: role is not allowed to view that document type.
- `409`: canonical document is still being repaired or materialized.
- `500/503`: preview extraction, Storage, or audit persistence failed.

The modal displays the API error and a Retry action. It never falls back to opening the DOCX URL because that recreates the unwanted download behavior.

## Security and privacy

- Storage objects remain private.
- Preview retrieval requires the same authenticated staff roles as document access.
- No document URL is sent to Microsoft Office Online Viewer or another third party.
- Preview HTML is isolated in a sandboxed iframe with restrictive CSP.
- Accounting never receives evaluation snapshots, files, or previews.
- Every successful preview is audit logged.

## Testing

### Backend

- Materialization uploads both DOCX and HTML before marking an artifact ready.
- Preview HTML is derived from the rendered DOCX buffer.
- A preview upload failure leaves the artifact retryable and not ready.
- The preview endpoint serves the stored HTML for an authorized role.
- Accounting is denied evaluation previews.
- A missing preview is generated from the existing Storage DOCX, saved, and returned.
- A missing or stale DOCX is repaired before preview extraction.
- Audit persistence is required before preview content is returned.

### Frontend

- Ready document cells render one Eye button and no Download button.
- Clicking Eye requests the preview endpoint and never requests attachment mode.
- The modal renders loading, error/retry, and sandboxed ready states.
- The record-summary Eye button continues to open the existing summary modal.

## Acceptance criteria

- Office sending course-closing notifications results in ready DOCX and HTML preview assets in private Storage.
- No per-student Download button appears on the archive page.
- Clicking a document Eye button never triggers a browser file download.
- Admin can view evaluation and tuition documents in the in-app modal.
- Existing records without preview assets are backfilled on first view.
- Role isolation and audit requirements remain enforced.

## Non-goals

- Pixel-perfect Microsoft Word pagination in the browser.
- Reproducing Word headers, footers, or watermarks in the Mammoth body preview.
- Removing the canonical DOCX files.
- Removing the existing file endpoint.
- Adding batch ZIP download or bulk export behavior.
