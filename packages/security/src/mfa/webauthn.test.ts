import { describe, expect, it } from 'vitest';

import { beginWebAuthnRegistration } from './webauthn.js';

describe('WebAuthn MFA', () => {
  it('binds registration challenges to the maintenance subdomain', async () => {
    const result = await beginWebAuthnRegistration({
      userId: 'f16f9426-010c-4e06-a459-9fd18c4a442d',
      username: 'ops.owner',
      displayName: 'Ops Owner'
    });

    expect(result.options.rp.id).toBe('man.thienuy.edu.vn');
    expect(result.options.rp.name).toBe('EduTrack Operations');
    expect(result.challenge).toBe(result.options.challenge);
    expect(result.challenge.length).toBeGreaterThan(20);
  });
});
