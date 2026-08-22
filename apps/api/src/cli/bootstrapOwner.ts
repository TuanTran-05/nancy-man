export type PendingOwnerInput = {
  username: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: 'pending_mfa';
  enrollmentTokenHash: string;
};

export type OwnerBootstrapRepository = {
  countActiveOwners: () => Promise<number>;
  createPendingOwner: (owner: PendingOwnerInput) => Promise<{ id: string }>;
};

export async function bootstrapOwner(input: {
  username: string;
  email: string;
  displayName: string;
  password: string;
  publicUrl: string;
  interactiveConfirmation: boolean;
  additionalOwner: boolean;
  repository: OwnerBootstrapRepository;
  hashPassword: (password: string) => Promise<string>;
  issueEnrollmentToken: () => { plainToken: string; tokenHash: string };
}): Promise<{ userId: string; enrollmentUrl: string }> {
  if (!input.interactiveConfirmation) {
    throw new Error('Owner bootstrap requires explicit TTY confirmation');
  }

  const activeOwnerCount = await input.repository.countActiveOwners();
  if (activeOwnerCount > 0 && !input.additionalOwner) {
    throw new Error('An active owner already exists; pass the explicit additional-owner option');
  }

  const publicUrl = new URL(input.publicUrl);
  if (publicUrl.protocol !== 'https:') {
    throw new Error('Owner enrollment must use an HTTPS public URL');
  }

  const passwordHash = await input.hashPassword(input.password);
  const enrollmentToken = input.issueEnrollmentToken();
  const owner = await input.repository.createPendingOwner({
    username: input.username,
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    status: 'pending_mfa',
    enrollmentTokenHash: enrollmentToken.tokenHash
  });
  const enrollmentUrl = new URL('/bootstrap/mfa', publicUrl);
  enrollmentUrl.searchParams.set('token', enrollmentToken.plainToken);
  enrollmentUrl.searchParams.set('userId', owner.id);

  return { userId: owner.id, enrollmentUrl: enrollmentUrl.toString() };
}
