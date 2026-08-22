import { describe, it, expect } from 'vitest';
import { validatePasswordStrength } from './passwordValidation';

describe('validatePasswordStrength', () => {
  it('should reject password shorter than 8 characters', () => {
    const result = validatePasswordStrength('Ab1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('8');
  });

  it('should reject password with exactly 7 characters', () => {
    const result = validatePasswordStrength('Abcdef1');
    expect(result.valid).toBe(false);
  });

  it('should accept password with exactly 8 characters meeting all rules', () => {
    const result = validatePasswordStrength('Abcdef1x');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject password without uppercase letter', () => {
    const result = validatePasswordStrength('abcdefg1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('chữ hoa');
  });

  it('should reject password without lowercase letter', () => {
    const result = validatePasswordStrength('ABCDEFG1');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('chữ thường');
  });

  it('should reject password without digit', () => {
    const result = validatePasswordStrength('Abcdefgh');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('chữ số');
  });

  it('should accept strong password', () => {
    const result = validatePasswordStrength('MyStr0ngPass');
    expect(result.valid).toBe(true);
  });

  it('should reject empty string', () => {
    const result = validatePasswordStrength('');
    expect(result.valid).toBe(false);
  });
});
