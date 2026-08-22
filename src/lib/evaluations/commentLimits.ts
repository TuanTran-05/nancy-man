export const EVALUATION_COMMENT_LIMITS = {
  total: 400,
  good: 200,
  bad: 200,
} as const;

export function limitTextLength(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
