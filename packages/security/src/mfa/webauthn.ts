import {
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON
} from '@simplewebauthn/server';

const rpId = 'man.thienuy.edu.vn';

export async function beginWebAuthnRegistration(input: {
  userId: string;
  username: string;
  displayName: string;
}): Promise<{ challenge: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const options = await generateRegistrationOptions({
    rpName: 'EduTrack Operations',
    rpID: rpId,
    userID: Buffer.from(input.userId, 'utf8'),
    userName: input.username,
    userDisplayName: input.displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required'
    }
  });

  return { challenge: options.challenge, options };
}
