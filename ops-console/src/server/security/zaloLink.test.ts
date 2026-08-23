import { describe, expect, it } from 'vitest';
import { hashZaloChatId, hashZaloLinkCode, parseOpsZaloLinkCommand } from './zaloLink.js';

describe('Ops Zalo link security helpers', () => {
  it('parses only the explicit /link CODE command', () => {
    expect(parseOpsZaloLinkCommand('/link ABCD1234')).toBe('ABCD1234');
    expect(parseOpsZaloLinkCommand(' /link abcd-1234 ')).toBe('ABCD1234');
    expect(parseOpsZaloLinkCommand('/link ABCD 1234')).toBeNull();
    expect(parseOpsZaloLinkCommand('/link ABC!1234')).toBeNull();
  });

  it('does not expose the code or chat ID in the stored digests', () => {
    expect(hashZaloLinkCode('ABCD1234', 'pepper')).not.toContain('ABCD1234');
    expect(hashZaloChatId('chat-123', 'pepper')).not.toContain('chat-123');
    expect(hashZaloLinkCode('ABCD1234', 'pepper')).toBe(hashZaloLinkCode('ABCD1234', 'pepper'));
    expect(hashZaloChatId('chat-123', 'pepper')).not.toBe(hashZaloChatId('chat-124', 'pepper'));
  });
});
