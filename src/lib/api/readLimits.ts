export const FRONTEND_COLLECTION_LIMIT = 2000;
export const FRONTEND_LARGE_COLLECTION_LIMIT = 2000;

/**
 * Keep the first student-directory response small enough to paint quickly.
 * Ninety-nine also leaves room for the server's one-row pagination lookahead
 * inside its 100-candidate scan batch. Remaining pages accumulate in the
 * background and are cached as one roster.
 */
export const STUDENT_DIRECTORY_PAGE_SIZE = 99;
