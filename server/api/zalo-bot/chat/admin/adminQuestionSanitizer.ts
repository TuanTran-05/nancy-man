export type SanitizedQuestion = {
  sanitizedText: string;
  extractedPhones: string[];
  extractedEmails: string[];
  extractedStudentCodes: string[];
  extractedMoneyLiterals: string[];
};

const PHONE_REGEX = /(?:\+?84|0)(?:[.\s-]?[35789])(?:[.\s-]?\d){8}\b/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const STUDENT_CODE_REGEX = /\b(?:HV|HS|STU|ID)[-_\s]?\d{3,8}\b/gi;
const MONEY_REGEX =
  /(?:\b\d[\d.,]*\s*(?:vnd|vnđ|đ|k|nghìn|ngàn|triệu|trieu|tỷ|ty)\b|[₫$]\s*\d[\d.,]*)/gi;

/**
 * Sanitizes a question before sending it to the external AI classifier.
 * Redacts direct identifiers (phone numbers, email addresses, student IDs)
 * so that raw PII is never sent to the AI prompt.
 * Keeps extracted tokens locally in memory for entity resolvers.
 */
export function sanitizeAdminQuestion(rawText: string): SanitizedQuestion {
  if (typeof rawText !== 'string') {
    return {
      sanitizedText: '',
      extractedPhones: [],
      extractedEmails: [],
      extractedStudentCodes: [],
      extractedMoneyLiterals: [],
    };
  }

  // Remove control characters except standard whitespace
  let text = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();

  const extractedPhones: string[] = [];
  const extractedEmails: string[] = [];
  const extractedStudentCodes: string[] = [];
  const extractedMoneyLiterals: string[] = [];

  // Extract and redact emails
  text = text.replace(EMAIL_REGEX, (match) => {
    extractedEmails.push(match);
    return '[EMAIL]';
  });

  // Extract and redact phones
  text = text.replace(PHONE_REGEX, (match) => {
    extractedPhones.push(match);
    return '[PHONE]';
  });

  // Extract and redact student codes
  text = text.replace(STUDENT_CODE_REGEX, (match) => {
    extractedStudentCodes.push(match);
    return '[STUDENT_CODE]';
  });

  text = text.replace(MONEY_REGEX, (match) => {
    extractedMoneyLiterals.push(match);
    return '[MONEY]';
  });

  const sanitizedText = text.replace(/\s+/g, ' ').trim();

  return {
    sanitizedText,
    extractedPhones,
    extractedEmails,
    extractedStudentCodes,
    extractedMoneyLiterals,
  };
}
