export type IssueStatus =
  | 'NEW'
  | 'ACKNOWLEDGED'
  | 'INVESTIGATING'
  | 'RESOLVED'
  | 'IGNORED'
  | 'REGRESSED';

export type ErrorIssueSummary = {
  issueId: `ISS_${string}`;
  fingerprint: string;
  status: IssueStatus;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  affectedUserEstimate: number;
};
