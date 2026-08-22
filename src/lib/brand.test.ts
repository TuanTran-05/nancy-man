import { describe, expect, it } from 'vitest';
import { CENTER_LOGO_URL } from './brand';

describe('center branding', () => {
  it('uses the approved Thiên Uy English Center logo URL', () => {
    expect(CENTER_LOGO_URL).toBe(
      'https://i.postimg.cc/5NPyBH5z/8f924ba5-ebef-4ae7-837e-808057d68243.png'
    );
  });
});
