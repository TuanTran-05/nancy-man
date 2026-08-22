// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

let mockedProfile: any;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'office-uid' },
    profile: mockedProfile,
    loading: false,
  }),
}));

describe('ProtectedRoute office access', () => {
  it('allows office when listed in allowedRoles', () => {
    mockedProfile = { role: 'office' };
    render(
      <MemoryRouter initialEntries={['/classes']}>
        <Routes>
          <Route
            path="/classes"
            element={
              <ProtectedRoute allowedRoles={['admin', 'teacher', 'office']}>
                <div>Classes Page</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Classes Page')).toBeDefined();
  });
});
