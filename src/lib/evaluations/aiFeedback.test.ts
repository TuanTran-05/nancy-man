import { describe, expect, it } from 'vitest';
import { parseGeneratedEvaluationFeedback } from './aiFeedback';

describe('parseGeneratedEvaluationFeedback', () => {
  it('parses valid feedback JSON', () => {
    expect(
      parseGeneratedEvaluationFeedback(
        '{"positivePoints":"Good effort","improvementPoints":"Needs more practice"}'
      )
    ).toEqual({
      positivePoints: 'Good effort',
      improvementPoints: 'Needs more practice',
    });
  });

  it('parses JSON wrapped in markdown fences', () => {
    expect(
      parseGeneratedEvaluationFeedback(
        '```json\n{"positivePoints":"Good","improvementPoints":"Bad"}\n```'
      )
    ).toEqual({
      positivePoints: 'Good',
      improvementPoints: 'Bad',
    });
  });

  it('parses JSON with a trailing comma', () => {
    expect(
      parseGeneratedEvaluationFeedback(
        '{"positivePoints":"Good","improvementPoints":"Needs more practice",}'
      )
    ).toEqual({
      positivePoints: 'Good',
      improvementPoints: 'Needs more practice',
    });
  });

  it('parses JSON-like feedback with literal newlines inside string values', () => {
    expect(
      parseGeneratedEvaluationFeedback(`{
        "positivePoints": "Good effort
Nice pronunciation",
        "improvementPoints": "Needs more practice
Review vocabulary",
      }`)
    ).toEqual({
      positivePoints: 'Good effort\nNice pronunciation',
      improvementPoints: 'Needs more practice\nReview vocabulary',
    });
  });

  it('normalizes double-escaped newlines in generated feedback strings', () => {
    expect(
      parseGeneratedEvaluationFeedback(
        '{"positivePoints":"Good effort\\\\nNice pronunciation","improvementPoints":"Tuy nhiên: Review vocabulary\\\\nPractice speaking"}'
      )
    ).toEqual({
      positivePoints: 'Good effort\nNice pronunciation',
      improvementPoints: 'Tuy nhiên: Review vocabulary\nPractice speaking',
    });
  });
});
