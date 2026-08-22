// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import BlockDevToolPage from './BlockDevToolPage';

function LocationProbe() {
  const location = useLocation();
  useEffect(() => {
    document.body.dataset.path = location.pathname;
  }, [location.pathname]);
  return null;
}

function setup(returnPath = '') {
  if (returnPath) {
    sessionStorage.setItem('edutrack:blockdevtool:returnPath', returnPath);
  } else {
    sessionStorage.removeItem('edutrack:blockdevtool:returnPath');
  }
}

describe('BlockDevToolPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('does not render a navigate-to-dashboard button', () => {
    setup();
    render(
      <MemoryRouter initialEntries={['/blockdevtool']}>
        <BlockDevToolPage />
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /Dashboard/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Quay lại Dashboard/i })).toBeNull();
  });

  it('navigates to the stored return path when acknowledged', async () => {
    setup('/assignments');
    render(
      <MemoryRouter initialEntries={['/blockdevtool']}>
        <LocationProbe />
        <Routes>
          <Route path="/blockdevtool" element={<BlockDevToolPage />} />
          <Route path="/assignments" element={<div>Assignments page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /Tôi đã hiểu/i }));
    expect(await screen.findByText('Assignments page')).toBeInTheDocument();
  });

  it('navigates to the root path when no return path is stored', async () => {
    setup();
    render(
      <MemoryRouter initialEntries={['/blockdevtool']}>
        <LocationProbe />
        <Routes>
          <Route path="/blockdevtool" element={<BlockDevToolPage />} />
          <Route path="/" element={<div>Root page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await userEvent.click(screen.getByRole('button', { name: /Tôi đã hiểu/i }));
    expect(await screen.findByText('Root page')).toBeInTheDocument();
  });
});
