// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { navigate, readRoute } from './routing.js';

describe('web routing', () => {
  it('normalizes canonical routes including /database', () => {
    const originalPath = window.location.pathname;
    try {
      window.history.replaceState({}, '', '/database');
      expect(readRoute()).toBe('/database');

      window.history.replaceState({}, '', '/variables');
      expect(readRoute()).toBe('/variables');

      window.history.replaceState({}, '', '/users');
      expect(readRoute()).toBe('/users');

      window.history.replaceState({}, '', '/issues');
      expect(readRoute()).toBe('/issues');

      window.history.replaceState({}, '', '/bootstrap/mfa');
      expect(readRoute()).toBe('/bootstrap/mfa');

      window.history.replaceState({}, '', '/');
      expect(readRoute()).toBe('/');
    } finally {
      window.history.replaceState({}, '', originalPath);
    }
  });

  it('normalizes unknown paths to /', () => {
    const originalPath = window.location.pathname;
    try {
      window.history.replaceState({}, '', '/unknown-route');
      expect(readRoute()).toBe('/');

      window.history.replaceState({}, '', '/sql');
      expect(readRoute()).toBe('/');
    } finally {
      window.history.replaceState({}, '', originalPath);
    }
  });

  it('navigates to /database and dispatches popstate', () => {
    const originalPath = window.location.pathname;
    try {
      navigate('/database');
      expect(window.location.pathname).toBe('/database');
      expect(readRoute()).toBe('/database');
    } finally {
      window.history.replaceState({}, '', originalPath);
    }
  });
});
