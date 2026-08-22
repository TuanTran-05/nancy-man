export type SafeAlert = {
  severity: 'critical' | 'high' | 'medium' | 'low';
  issueId: string;
  title: string;
  service: string;
  release: string;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  issueUrl: string;
};

function safeText(value: string, maximumLength: number): string {
  return value
    .slice(0, maximumLength)
    .replace(/(?:bearer|password|authorization|token|cookie|otp)\s*[:= ]\s*[^\s,;]+/gi, '[REDACTED]');
}

export function formatSafeAlert(alert: SafeAlert): { subject: string; text: string } {
  const severity = alert.severity.toUpperCase();
  const subject = `[${severity}] ${alert.issueId} — ${safeText(alert.title, 180)}`;
  return {
    subject,
    text: [
      subject,
      `Service: ${safeText(alert.service, 120)}`,
      `Release: ${safeText(alert.release, 80)}`,
      `Occurrences: ${Math.max(0, alert.occurrenceCount)}`,
      `First seen: ${alert.firstSeenAt.toISOString()}`,
      `Last seen: ${alert.lastSeenAt.toISOString()}`,
      `Open: ${alert.issueUrl}`
    ].join('\n')
  };
}
