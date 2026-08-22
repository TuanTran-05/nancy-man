// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ManagementTabs } from './ManagementTabs';

vi.mock('../lib/i18n/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

describe('ManagementTabs teachers group', () => {
  it('renders teacher tabs for admin with links to each page', () => {
    render(
      <MemoryRouter initialEntries={['/teacher-attendance']}>
        <ManagementTabs group="teachers" role="admin" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Teachers' })).toHaveAttribute('href', '/teachers');
    expect(screen.getByRole('link', { name: 'Teacher Attendance' })).toHaveAttribute(
      'href',
      '/teacher-attendance'
    );
    expect(screen.getByRole('link', { name: 'Availability' })).toHaveAttribute(
      'href',
      '/teacher-availability'
    );
  });

  it('marks the tab matching the current path as active', () => {
    render(
      <MemoryRouter initialEntries={['/teacher-attendance']}>
        <ManagementTabs group="teachers" role="admin" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Teacher Attendance' }).className).toContain(
      'text-blue-600'
    );
    expect(screen.getByRole('link', { name: 'Teachers' }).className).not.toContain('text-blue-600');
  });

  it('renders teacher tabs for office', () => {
    render(
      <MemoryRouter initialEntries={['/teachers']}>
        <ManagementTabs group="teachers" role="office" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Teacher Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Availability' })).toBeInTheDocument();
  });

  it('renders nothing for teacher role', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/teacher-availability']}>
        <ManagementTabs group="teachers" role="teacher" />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('ManagementTabs classes group', () => {
  it('renders class tabs for admin', () => {
    render(
      <MemoryRouter initialEntries={['/classes']}>
        <ManagementTabs group="classes" role="admin" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Classes' })).toHaveAttribute('href', '/classes');
    expect(screen.getByRole('link', { name: 'Knowledge Bank' })).toHaveAttribute(
      'href',
      '/knowledge-bank'
    );
    expect(screen.getByRole('link', { name: 'Substitute' })).toHaveAttribute(
      'href',
      '/substitute-requests'
    );
  });

  it('keeps the classes tab active on knowledge bank drill-down routes', () => {
    render(
      <MemoryRouter initialEntries={['/knowledge-bank/global-success/grade-6']}>
        <ManagementTabs group="classes" role="admin" />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Knowledge Bank' }).className).toContain(
      'text-blue-600'
    );
  });

  it('renders nothing for office because only one tab is accessible', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/classes']}>
        <ManagementTabs group="classes" role="office" />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when role is missing', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/classes']}>
        <ManagementTabs group="classes" role={null} />
      </MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
