// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssuesPage } from './IssuesPage.js';
import type { InboxIssue, IssueDetail, SessionInfo } from '../api.js';

afterEach(() => cleanup());

const mockSession: SessionInfo = {
  userId: 'test-user',
  username: 'ops.admin',
  displayName: 'Ops Admin',
  role: 'ops_maintainer',
  csrfToken: 'test-csrf'
};

const mockIssues: InboxIssue[] = [
  {
    id: 'issue-1',
    fingerprint: 'fp-1',
    title: 'ValidationError: Invalid student payload',
    errorCode: 'bad_request',
    source: 'api',
    severity: 'medium',
    status: 'new',
    firstSeenAt: '2026-09-18T05:00:00.000Z',
    lastSeenAt: '2026-09-18T05:30:00.000Z',
    occurrenceCount: 3,
    affectedUserCount: 1
  }
];

const mockDetail: IssueDetail = {
  issue: mockIssues[0],
  events: [
    {
      eventId: 'EVT_01J85G8Q2R8F1G7N7T4M6B9K12',
      occurredAt: '2026-09-18T05:30:00.000Z',
      source: 'api',
      severity: 'medium',
      errorCode: 'bad_request',
      safeMessage: 'Invalid date of birth format',
      stackTrace:
        'Error: Invalid date of birth\n    at handleCreate (/server/api/students/handlers/create.ts:26:14)',
      requestId: 'REQ_123456789',
      route: '/api/students',
      httpStatus: 400
    }
  ],
  activities: [
    {
      id: 'act-1',
      activityType: 'created',
      occurredAt: '2026-09-18T05:00:00.000Z'
    }
  ]
};

describe('IssuesPage', () => {
  it('renders issues list and loads issue detail on selection', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/v1/issues/issue-1')) {
        return new Response(JSON.stringify(mockDetail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('/api/v1/issues')) {
        return new Response(JSON.stringify({ issues: mockIssues }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('{}', { status: 404 });
    };

    const user = userEvent.setup();
    render(<IssuesPage session={mockSession} onUnauthorized={() => {}} />);

    expect(await screen.findByText('Sự cố & Lỗi hệ thống')).toBeInTheDocument();
    expect(await screen.findByText('ValidationError: Invalid student payload')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // Click on issue to load detail
    await user.click(screen.getByText('ValidationError: Invalid student payload'));

    // Wait for detail to show
    expect(await screen.findByText('REQ_123456789')).toBeInTheDocument();
    expect(screen.getByText('Invalid date of birth format')).toBeInTheDocument();
    expect(screen.getByText(/handleCreate/)).toBeInTheDocument();
    expect(screen.getByText('Đang điều tra')).toBeInTheDocument();
  });
});
