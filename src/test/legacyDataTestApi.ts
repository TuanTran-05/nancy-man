/**
 * Resolution-only exports for tests that still model the retired document-query API.
 * Test suites replace these functions with `vi.mock`; production code never imports this module.
 */
function retired(..._args: any[]): any {
  throw new Error('Retired data test API must be mocked by the test');
}

export const collection = retired;
export const doc = retired;
export const getDoc = retired;
export const getDocs = retired;
export const onSnapshot = retired;
export const query = retired;
export const where = retired;
