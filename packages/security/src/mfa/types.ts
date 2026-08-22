export type MfaProof = {
  userId: string;
  factorId: string;
  factorType: 'webauthn' | 'totp' | 'recovery_code';
  verifiedAt: string;
};
