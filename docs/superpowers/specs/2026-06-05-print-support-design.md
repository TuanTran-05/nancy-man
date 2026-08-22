# Print Support Design

## Goal

Build a print-support workflow so teachers can submit print requests inside EduTrack instead of sending files and notes through Zalo. Office staff can receive, filter, print, reject, and complete those requests while teachers can track status.

## Approved Decisions

- The feature is for `teacher` and `office` only.
- `admin` does not get a menu item, route access, or operational actions. Admin oversight happens through the existing audit log.
- Do not create a new serverless function because the project is constrained by the 12-function limit.
- Use existing function files:
  - `api/knowledge-bank/[action].ts` for multipart upload and signed file download actions.
  - `api/classes/[action].ts` for JSON status actions.
- Create a separate Firestore collection named `print_requests`.
- Store files under a separate Firebase Storage prefix named `print_requests/`.
- A ticket can contain multiple files.
- Each file has its own print quantity.
- Teachers choose only classes they currently teach.
- Teachers provide a needed date and time.
- Office can filter by both request-created date and needed date.
- The form does not include structured options for color, duplex, or paper size. Teachers can use the free-text note for special instructions.
- Office sidebar shows a badge with the count of `pending` print requests.

## Status Workflow

Allowed statuses:

- `pending`: teacher submitted the request and office has not completed printing.
- `printed`: office has printed the files, but handoff is not finished.
- `completed`: office has handed off the printed documents.
- `rejected`: office rejected the request because files are broken, unsupported, or information is not usable.
- `cancelled`: teacher cancelled the request before printing started.

Allowed transitions:

- `pending` -> `printed`
- `printed` -> `completed`
- `pending` -> `rejected`
- `pending` -> `cancelled`

Teachers can cancel only while the request is `pending`. Once office marks a request `printed`, teacher cancellation is blocked.

## Data Model

Collection: `print_requests`

```ts
type PrintRequestStatus = 'pending' | 'printed' | 'completed' | 'rejected' | 'cancelled';

interface PrintRequestFile {
  id: string;
  originalFilename: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  quantity: number;
}

interface PrintRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  neededAt: string;
  neededDate: string;
  createdDate: string;
  status: PrintRequestStatus;
  note?: string;
  files: PrintRequestFile[];
  createdAt: string;
  updatedAt?: string;
  printedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  handledBy?: string;
  handledByName?: string;
  rejectionReason?: string;
}
```

## File Types

Allow common office and image files:

- PDF
- DOC, DOCX
- PPT, PPTX
- XLS, XLSX
- JPG, JPEG, PNG

The server must validate extension and MIME type. For formats with reliable signatures in the current helper code, keep signature checks. For legacy Office formats where MIME and magic bytes can vary, validate extension plus MIME and keep the storage path locked behind signed URLs.

## Backend Design

`api/knowledge-bank/[action].ts` gains:

- `upload-print-request`: multipart POST that validates the teacher, class ownership, files, quantities, and deadline; uploads files; creates the `print_requests` document; writes an audit log.
- `print-request-file`: GET that validates teacher ownership or office role and returns a short-lived signed URL for a single file.

`api/classes/[action].ts` gains:

- `cancel-print-request`: teacher-only JSON POST, `pending` only.
- `update-print-request-status`: office-only JSON POST, supports `printed`, `completed`, and `rejected`.

No new API route file is created.

## Frontend Design

Route: `/print-support`

Teacher view:

- Create request button and modal/form.
- Fields: class, needed date and time, note, multiple files.
- Each file row has a quantity input.
- List of the teacher's own tickets.
- Cancel button appears only for `pending` tickets.
- Status is visible on every ticket.

Office view:

- Pending count is visible as a sidebar badge.
- Filters: created date, needed date, status, and text search by teacher/class.
- Default sort prioritizes `pending` requests with the nearest `neededAt`.
- Ticket details show teacher, class, needed time, note, files, and per-file quantities.
- Actions:
  - Mark printed
  - Mark completed
  - Reject with required reason
  - Download/open each file through the signed URL API

## Firestore And Storage Rules

Firestore `print_requests`:

- Teacher can read only requests where `teacherId == request.auth.uid`.
- Office can read all print requests.
- Client create, update, and delete are all denied.

Storage `print_requests/**`:

- Direct client read and write are denied.
- Upload and download happen through server APIs only.

## Testing Scope

API tests:

- Teacher can create a valid multi-file request.
- Teacher cannot create a request for a class they do not teach.
- Teacher can cancel only a `pending` request.
- Office can mark `pending` as `printed`.
- Office can mark `printed` as `completed`.
- Office rejection from `pending` requires a rejection reason.

Rules tests:

- Firestore rules contain teacher/office read permissions and client write denial.
- Storage rules lock down `print_requests/**`.

Frontend tests:

- Teacher form validates required fields and per-file quantities.
- Teacher cancel action is visible only for pending tickets.
- Office filters by created date, needed date, and status.
- Office sidebar badge shows pending count.

## Out Of Scope

- Zalo notifications.
- Editing a submitted ticket.
- Structured print options such as color, duplex, or paper size.
- Admin route/menu/page for print requests.
- Automatic file deletion when a request is completed.
