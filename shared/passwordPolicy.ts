export type PasswordPolicyLocale = 'vi' | 'en';

type PasswordPolicyMessages = {
  minLength: string;
  uppercase: string;
  lowercase: string;
  digit: string;
};

const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyLocale, PasswordPolicyMessages> = {
  vi: {
    minLength: 'Mật khẩu phải có ít nhất 8 ký tự.',
    uppercase: 'Mật khẩu phải chứa ít nhất 1 chữ hoa.',
    lowercase: 'Mật khẩu phải chứa ít nhất 1 chữ thường.',
    digit: 'Mật khẩu phải chứa ít nhất 1 chữ số.',
  },
  en: {
    minLength: 'Password must be at least 8 characters.',
    uppercase: 'Password must contain at least 1 uppercase letter.',
    lowercase: 'Password must contain at least 1 lowercase letter.',
    digit: 'Password must contain at least 1 number.',
  },
};

export function validatePasswordStrength(
  password: string,
  locale: PasswordPolicyLocale = 'vi'
): { valid: boolean; error?: string } {
  const messages = PASSWORD_POLICY_MESSAGES[locale];
  if (password.length < 8) return { valid: false, error: messages.minLength };
  if (!/[A-Z]/.test(password)) return { valid: false, error: messages.uppercase };
  if (!/[a-z]/.test(password)) return { valid: false, error: messages.lowercase };
  if (!/[0-9]/.test(password)) return { valid: false, error: messages.digit };
  return { valid: true };
}
