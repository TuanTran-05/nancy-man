/** Resolution-only exports for obsolete auth-flow tests while they move to session HTTP mocks. */
function retired(..._args: any[]): any {
  throw new Error('Retired auth test API must be mocked by the test');
}

export const onAuthStateChanged = retired;
export const signInWithCustomToken = retired;
export const signInWithEmailAndPassword = retired;
export const signInWithPhoneNumber = retired;
export const signInWithPopup = retired;
