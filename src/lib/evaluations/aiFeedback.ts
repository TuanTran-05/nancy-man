export interface GeneratedEvaluationFeedback {
  positivePoints: string;
  improvementPoints: string;
}

function extractJsonObject(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return withoutFence;
  return withoutFence.slice(start, end + 1);
}

function normalizeJsonLikeText(text: string) {
  return extractJsonObject(text).replace(/,\s*([}\]])/g, '$1');
}

function unescapeStringValue(value: string) {
  return value.replace(/\\(["\\/bfnrt])/g, (_, escaped: string) => {
    if (escaped === 'n') return '\n';
    if (escaped === 'r') return '\r';
    if (escaped === 't') return '\t';
    if (escaped === 'b') return '\b';
    if (escaped === 'f') return '\f';
    return escaped;
  });
}

function isFieldValueTerminator(source: string, index: number) {
  const rest = source.slice(index).trimStart();
  return rest.startsWith(',') || rest.startsWith('}');
}

function extractLooseStringField(source: string, field: string) {
  const fieldMatch = new RegExp(`"${field}"\\s*:\\s*"`).exec(source);
  if (!fieldMatch) return '';

  const start = fieldMatch.index + fieldMatch[0].length;
  let value = '';
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '\\' && next) {
      value += char + next;
      i += 1;
      continue;
    }

    if (char === '"' && isFieldValueTerminator(source, i + 1)) {
      return unescapeStringValue(value).trim();
    }

    value += char;
  }

  return unescapeStringValue(value).trim();
}

function parseLooseFeedback(text: string) {
  const source = normalizeJsonLikeText(text);
  return {
    positivePoints: normalizeGeneratedFeedbackText(
      extractLooseStringField(source, 'positivePoints')
    ),
    improvementPoints: normalizeGeneratedFeedbackText(
      extractLooseStringField(source, 'improvementPoints')
    ),
  };
}

function normalizeGeneratedFeedbackText(value: string) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

export function parseGeneratedEvaluationFeedback(text: string): GeneratedEvaluationFeedback {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(normalizeJsonLikeText(text));
  } catch {
    const feedback = parseLooseFeedback(text);
    if (feedback.positivePoints || feedback.improvementPoints) return feedback;
    throw new Error('AI feedback response was not valid JSON.');
  }
  return {
    positivePoints:
      typeof parsed.positivePoints === 'string'
        ? normalizeGeneratedFeedbackText(parsed.positivePoints)
        : '',
    improvementPoints:
      typeof parsed.improvementPoints === 'string'
        ? normalizeGeneratedFeedbackText(parsed.improvementPoints)
        : '',
  };
}

export const evaluationFeedbackJsonSchema = {
  type: 'object',
  properties: {
    positivePoints: { type: 'string' },
    improvementPoints: { type: 'string' },
  },
  required: ['positivePoints', 'improvementPoints'],
  additionalProperties: false,
};
