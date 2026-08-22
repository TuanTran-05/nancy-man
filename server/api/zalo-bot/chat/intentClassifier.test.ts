import { describe, it, expect, beforeEach, vi } from 'vitest';

const genaiMocks = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: genaiMocks.generateContent } };
  }),
  ThinkingLevel: {
    MINIMAL: 'MINIMAL',
  },
}));

import { classifyZaloBotChatQuestion, ZaloBotChatClassifierError } from './intentClassifier.js';

describe('classifyZaloBotChatQuestion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses a well-formed classification', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'class_student_count', classNameHint: '7A1' }),
    });

    const result = await classifyZaloBotChatQuestion({
      text: 'lớp 7A1 có bao nhiêu học sinh',
      apiKey: 'key',
    });

    expect(result).toEqual({ intent: 'class_student_count', classNameHint: '7A1' });
  });

  it('turns an empty hint into null', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'my_todo', classNameHint: '' }),
    });

    const result = await classifyZaloBotChatQuestion({ text: 'tôi còn việc gì', apiKey: 'key' });

    expect(result).toEqual({ intent: 'my_todo', classNameHint: null });
  });

  it('accepts the class end-date intent with its class hint', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'class_end_date', classNameHint: 'Movers - Mr. Anh Tuan' }),
    });

    const result = await classifyZaloBotChatQuestion({
      text: 'Khi nào lớp Movers - Mr. Anh Tuan kết khóa?',
      apiKey: 'key',
    });

    expect(result).toEqual({
      intent: 'class_end_date',
      classNameHint: 'Movers - Mr. Anh Tuan',
    });
    expect(genaiMocks.generateContent.mock.calls[0][0].config.systemInstruction).toContain(
      'class_end_date'
    );
  });

  it('falls back to unsupported for an unknown intent', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'transfer_money', classNameHint: '7A1' }),
    });

    const result = await classifyZaloBotChatQuestion({ text: 'chuyển tiền', apiKey: 'key' });

    expect(result.intent).toBe('unsupported');
  });

  it('treats non-JSON as a provider contract failure, not an unsupported question', async () => {
    genaiMocks.generateContent.mockResolvedValue({ text: 'xin chào' });

    await expect(classifyZaloBotChatQuestion({ text: 'hi', apiKey: 'key' })).rejects.toBeInstanceOf(
      ZaloBotChatClassifierError
    );
  });

  it('caps how much of the hint it will carry forward', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'class_student_count', classNameHint: 'x'.repeat(500) }),
    });

    const result = await classifyZaloBotChatQuestion({ text: 'hỏi', apiKey: 'key' });

    expect(result.classNameHint).toHaveLength(64);
  });

  it('raises a classifier error when the provider fails', async () => {
    genaiMocks.generateContent.mockRejectedValue(new Error('boom'));

    await expect(
      classifyZaloBotChatQuestion({ text: 'hỏi', apiKey: 'key' })
    ).rejects.toBeInstanceOf(ZaloBotChatClassifierError);
  });

  it('raises a classifier error when the provider hangs past the timeout', async () => {
    vi.useFakeTimers();
    genaiMocks.generateContent.mockReturnValue(new Promise(() => {}));

    const pending = classifyZaloBotChatQuestion({ text: 'hỏi', apiKey: 'key' });
    const assertion = expect(pending).rejects.toBeInstanceOf(ZaloBotChatClassifierError);
    await vi.advanceTimersByTimeAsync(9000);
    await assertion;
    vi.useRealTimers();
  });

  it('rejects a question longer than the input cap without calling the provider', async () => {
    const result = await classifyZaloBotChatQuestion({
      text: 'a'.repeat(1001),
      apiKey: 'key',
    });

    expect(result.intent).toBe('unsupported');
    expect(genaiMocks.generateContent).not.toHaveBeenCalled();
  });

  it('passes the previous class as context without letting it become the answer', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'attendance_today', classNameHint: '' }),
    });

    await classifyZaloBotChatQuestion({
      text: 'còn lớp đó thì sao',
      apiKey: 'key',
      previousClassName: '7A1',
    });

    const call = genaiMocks.generateContent.mock.calls[0][0];
    expect(String(call.contents)).toContain('7A1');
  });

  it('always calls the approved fixed model', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'unsupported', classNameHint: '' }),
    });

    await classifyZaloBotChatQuestion({ text: 'xin chào', apiKey: 'key' });

    expect(genaiMocks.generateContent.mock.calls[0][0].model).toBe('gemini-3.5-flash');
  });

  it('uses minimal thinking and enough output budget for structured JSON', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ intent: 'class_student_count', classNameHint: '9C1' }),
    });

    await classifyZaloBotChatQuestion({
      text: 'Lớp 9C1 có bao nhiêu học sinh?',
      apiKey: 'key',
    });

    const config = genaiMocks.generateContent.mock.calls[0][0].config;
    expect(config).toMatchObject({
      maxOutputTokens: 512,
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
      responseMimeType: 'application/json',
      responseJsonSchema: expect.any(Object),
    });
    expect(config).not.toHaveProperty('temperature');
  });

  it('reports safe metadata when Gemini exhausts output before returning JSON', async () => {
    genaiMocks.generateContent.mockResolvedValue({
      text: '',
      candidates: [{ finishReason: 'MAX_TOKENS' }],
      usageMetadata: {
        thoughtsTokenCount: 256,
        candidatesTokenCount: 0,
      },
    });

    await expect(
      classifyZaloBotChatQuestion({
        text: 'Lớp 9C1 có bao nhiêu học sinh?',
        apiKey: 'key',
      })
    ).rejects.toThrow(
      'Gemini returned empty JSON (finishReason=MAX_TOKENS, thoughtsTokenCount=256, candidatesTokenCount=0)'
    );
  });
});
