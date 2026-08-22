import { createHmac } from 'node:crypto';

import argon2 from 'argon2';

type PasswordParameters = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

export const productionPasswordParameters: Readonly<PasswordParameters> = Object.freeze({
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1
});

const blockedDemoPasswords = new Set([
  'correct horse battery staple',
  'password12345678',
  'letmeinletmein',
  'change-me-password'
]);

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function resolveParameters(
  parameters: Partial<PasswordParameters> | undefined
): PasswordParameters {
  const resolved = { ...productionPasswordParameters, ...parameters };
  if (
    !Number.isInteger(resolved.memoryCost) ||
    !Number.isInteger(resolved.timeCost) ||
    !Number.isInteger(resolved.parallelism) ||
    resolved.memoryCost < 8_192 ||
    resolved.timeCost < 1 ||
    resolved.parallelism < 1
  ) {
    throw new Error('Argon2id parameters are below the minimum safety floor');
  }

  return resolved;
}

export function passwordFingerprint(password: string, pepper: string): string {
  if (!pepper) {
    throw new Error('Password fingerprint pepper is required');
  }

  return createHmac('sha256', pepper).update(password, 'utf8').digest('hex');
}

export function validatePasswordPolicy(input: {
  password: string;
  username?: string;
  email?: string;
  recentFingerprints?: readonly string[];
  fingerprintPepper?: string;
}): void {
  if (input.password.length < 14) {
    throw new Error('Password must contain at least 14 characters');
  }

  const lowercasePassword = input.password.toLowerCase();
  if (blockedDemoPasswords.has(lowercasePassword)) {
    throw new Error('This password is not allowed');
  }

  const username = normalized(input.username);
  const email = normalized(input.email);
  const emailLocalPart = email.split('@')[0] ?? '';
  if (
    (username.length >= 3 && lowercasePassword.includes(username)) ||
    (emailLocalPart.length >= 3 && lowercasePassword.includes(emailLocalPart))
  ) {
    throw new Error('Password must not contain an account identifier');
  }

  if (input.recentFingerprints?.length && input.fingerprintPepper) {
    const fingerprint = passwordFingerprint(input.password, input.fingerprintPepper);
    if (input.recentFingerprints.includes(fingerprint)) {
      throw new Error('Password reuse is not allowed');
    }
  }
}

export async function hashPassword(
  password: string,
  options: { parameters?: Partial<PasswordParameters> } = {}
): Promise<string> {
  validatePasswordPolicy({ password });
  const parameters = resolveParameters(options.parameters);

  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: parameters.memoryCost,
    timeCost: parameters.timeCost,
    parallelism: parameters.parallelism
  });
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(encodedHash, password);
  } catch {
    return false;
  }
}

export function needsPasswordRehash(encodedHash: string): boolean {
  return argon2.needsRehash(encodedHash, productionPasswordParameters);
}
