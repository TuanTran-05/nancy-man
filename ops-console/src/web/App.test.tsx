// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

describe('dashboard shell', () => {
  it('does not render destructive controls in the login shell', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(screen.queryByText(/Restart|Chạy SQL/i)).not.toBeInTheDocument();
  });
});
