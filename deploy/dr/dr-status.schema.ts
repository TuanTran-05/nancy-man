export type DrGateStatus = {
  approved: boolean;
  approvedAt: string | null;
  evidenceSha256: string | null;
  measuredRpoSeconds: number | null;
  measuredRtoSeconds: number | null;
  expiresAt: string | null;
};

export const disabledDrGateStatus: DrGateStatus = Object.freeze({
  approved: false,
  approvedAt: null,
  evidenceSha256: null,
  measuredRpoSeconds: null,
  measuredRtoSeconds: null,
  expiresAt: null
});

export function isApprovedDrGate(status: DrGateStatus, now = new Date()): boolean {
  if (
    !status.approved ||
    !status.approvedAt ||
    !status.evidenceSha256 ||
    status.measuredRpoSeconds === null ||
    status.measuredRtoSeconds === null ||
    !status.expiresAt
  ) {
    return false;
  }

  return (
    status.measuredRpoSeconds <= 60 &&
    status.measuredRtoSeconds <= 900 &&
    Date.parse(status.expiresAt) > now.getTime()
  );
}
