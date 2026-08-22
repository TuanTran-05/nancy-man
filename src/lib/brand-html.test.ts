import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CENTER_LOGO_URL } from './brand';

describe('pre-React center branding', () => {
  it('uses the approved center logo and removes the old logo URL', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain(`src="${CENTER_LOGO_URL}"`);
    expect(html).toContain('alt="Thiên Uy English Center Logo"');
    expect(html).not.toContain('https://i.postimg.cc/5NNY6RsL/Picture1.png');
  });
});
