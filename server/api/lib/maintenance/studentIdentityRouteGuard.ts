import type { ApiRequest, ApiResponse } from '@/server/api/lib/http/types.js';
import type { DocumentStore } from '@/server/db/documentStore.js';
import {
  assertStudentIdentityMutationAllowed,
  StudentIdentityMaintenanceError,
} from './studentIdentityMaintenance.js';
import {
  classifyStudentIdentityRouteMutation,
  type StudentIdentityMutationSurface,
} from './studentIdentityMutationInventory.js';

/**
 * The route-boundary half of the maintenance guard.
 *
 * This exists for the operator, not for correctness. It turns "your request
 * failed somewhere in the middle" into a clean 503 before any work starts.
 *
 * It also fails closed (HTTP 500 STUDENT_IDENTITY_MUTATION_UNCLASSIFIED) if a
 * mutating request is dispatched to an action that has not been explicitly
 * classified in studentIdentityMutationInventory.ts.
 */

const HTTP_REQUEST_ACTOR = 'http-request';

export async function guardStudentIdentityRouteMutation(
  getDb: () => DocumentStore,
  res: ApiResponse,
  input: {
    surface: StudentIdentityMutationSurface;
    resource?: string;
    action: string;
    req: Pick<ApiRequest, 'method'>;
  }
): Promise<boolean> {
  const method = String(input.req.method || '').toUpperCase();
  const disposition = classifyStudentIdentityRouteMutation({
    surface: input.surface,
    resource: input.resource,
    action: input.action,
    method,
  });

  if (disposition === 'unclassified_write') {
    const operation = input.resource
      ? `${input.surface}:${input.resource}:${input.action}`
      : `${input.surface}:${input.action}`;
    res.status(500).json({
      success: false,
      code: 'STUDENT_IDENTITY_MUTATION_UNCLASSIFIED',
      error: `Unclassified mutation route ${operation}. Every mutating route must be explicitly classified in studentIdentityMutationInventory.ts.`,
    });
    return true;
  }

  if (disposition !== 'student_mutation') {
    return false;
  }

  const operation = input.resource
    ? `${input.surface}:${input.resource}:${input.action}`
    : `${input.surface}:${input.action}`;
  try {
    await assertStudentIdentityMutationAllowed(getDb(), {
      actorId: HTTP_REQUEST_ACTOR,
      operation,
    });
    return false;
  } catch (error) {
    if (error instanceof StudentIdentityMaintenanceError) {
      res.status(503).json({
        success: false,
        code: error.code,
        error: `${operation} is paused while student records are being normalized. Please try again shortly.`,
      });
      return true;
    }
    console.warn('[student-identity-guard] maintenance check failed', operation);
    res.status(503).json({
      success: false,
      code: 'STUDENT_IDENTITY_MAINTENANCE_CHECK_FAILED',
      error: `${operation} could not verify the student maintenance state. Please try again shortly.`,
    });
    return true;
  }
}
