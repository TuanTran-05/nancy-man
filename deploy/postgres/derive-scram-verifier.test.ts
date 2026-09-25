import { spawnSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const helperPath = fileURLToPath(new URL('./derive-scram-verifier.mjs', import.meta.url));

describe('PostgreSQL SCRAM-SHA-256 password verifier', () => {
  it('matches the RFC 7677 SCRAM-SHA-256 exchange vector for a fixed salt', async () => {
    const helper = await import('./derive-scram-verifier.mjs').catch(() => undefined);

    expect(helper).toBeDefined();
    if (!helper) return;

    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const verifier = helper.deriveScramVerifier('pencil', salt);
    expect(verifier).toBe(
      'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU='
    );

    const verifierParts = verifier.split('$');
    const [storedKeyText, serverKeyText] = verifierParts[2]?.split(':') ?? [];
    const saltedPassword = pbkdf2Sync('pencil', salt, 4096, 32, 'sha256');
    const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
    const storedKey = Buffer.from(storedKeyText ?? '', 'base64');
    const serverKey = Buffer.from(serverKeyText ?? '', 'base64');
    const authMessage =
      'n=user,r=rOprNGfwEbeRWgbNEkqO,' +
      'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,' +
      'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
    const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
    const clientProof = Buffer.from(clientKey.map((byte, index) => byte ^ clientSignature[index]));
    const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest('base64');

    expect(verifierParts[1]).toBe('4096:W22ZaJ0SNY7soEsUEjb6gQ==');
    expect(createHash('sha256').update(clientKey).digest()).toEqual(storedKey);
    expect(clientProof.toString('base64')).toBe('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=');
    expect(serverSignature).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });

  it('reads a password from stdin and writes only a PostgreSQL SCRAM verifier', () => {
    const run = spawnSync(process.execPath, [helperPath], {
      encoding: 'utf8',
      input: 'wrapper-sentinel-password-0123456789-abcdefghijklmnopqrstuvwxyz'
    });

    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    expect(run.stdout.trim()).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/u
    );
    expect(run.stdout).not.toContain('wrapper-sentinel-password');
  });
});
