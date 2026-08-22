import type {
  ZaloPayloadSnapshot,
  ZaloTemplateData,
  ZaloTemplateDetail,
  ZaloTemplateParam,
  ZaloTemplateValue,
} from '../../../../shared/zaloAdmin.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_PARAM_PATTERN =
  /^(otp|otp_code|password|pass_word|secret|pin|access_token|refresh_token|token)$/i;

export function isSensitiveZaloTemplate(
  template: Pick<ZaloTemplateDetail, 'templateId' | 'listParams'>,
  configured: { otpTemplateId: string; staffTemplateId: string }
): boolean {
  if (
    template.templateId === configured.otpTemplateId ||
    template.templateId === configured.staffTemplateId
  ) {
    return true;
  }
  return template.listParams.some((param) => SENSITIVE_PARAM_PATTERN.test(param.name));
}

export function normalizeAndValidateTemplateData(
  params: ZaloTemplateParam[],
  input: Record<string, unknown>
): { ok: true; data: ZaloTemplateData } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const data: ZaloTemplateData = {};

  for (const param of params) {
    const raw = input[param.name];
    const text = raw == null ? '' : String(raw).trim();
    if (!text) {
      if (param.require && !param.acceptNull) errors.push(`${param.name} là trường bắt buộc.`);
      continue;
    }
    if (param.minLength > 0 && text.length < param.minLength) {
      errors.push(`${param.name} phải có ít nhất ${param.minLength} ký tự.`);
      continue;
    }
    if (param.maxLength > 0 && text.length > param.maxLength) {
      errors.push(`${param.name} không được vượt quá ${param.maxLength} ký tự.`);
      continue;
    }
    if (param.type.toUpperCase() === 'NUMBER') {
      const numberValue = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(numberValue)) {
        errors.push(`${param.name} phải là một số hợp lệ.`);
        continue;
      }
      data[param.name] = numberValue;
      continue;
    }
    data[param.name] = text;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, data };
}

export function createZaloPayloadSnapshot(input: {
  templateId: string;
  templateName?: string;
  previewUrl?: string;
  phone: string;
  templateData: Record<string, ZaloTemplateValue>;
  capturedAt?: string;
}): ZaloPayloadSnapshot {
  const redactedFields: string[] = [];
  const templateData = Object.fromEntries(
    Object.entries(input.templateData).map(([key, value]) => {
      if (SENSITIVE_PARAM_PATTERN.test(key)) {
        redactedFields.push(key);
        return [key, REDACTED];
      }
      return [key, value];
    })
  ) as ZaloTemplateData;

  return {
    schemaVersion: 1,
    templateId: input.templateId,
    ...(input.templateName ? { templateName: input.templateName } : {}),
    ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
    phone: input.phone,
    templateData,
    capturedAt: input.capturedAt || new Date().toISOString(),
    redactedFields,
  };
}
