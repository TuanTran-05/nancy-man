export type ZaloTemplateValue = string | number;
export type ZaloTemplateData = Record<string, ZaloTemplateValue>;

export interface ZaloTemplateParam {
  name: string;
  require: boolean;
  type: string;
  minLength: number;
  maxLength: number;
  acceptNull: boolean;
}

export interface ZaloTemplateSummary {
  templateId: string;
  templateName: string;
  status: string;
  templateQuality: string;
  source: 'zalo' | 'configured';
}

export interface ZaloTemplateDetail extends ZaloTemplateSummary {
  listParams: ZaloTemplateParam[];
  previewUrl?: string;
  templateTag?: string;
  priceSdt?: string;
}

export interface ZaloPayloadSnapshot {
  schemaVersion: 1;
  templateId: string;
  templateName?: string;
  previewUrl?: string;
  phone: string;
  templateData: ZaloTemplateData;
  capturedAt: string;
  redactedFields: string[];
}

export interface ZaloTemplateListResponse {
  success: boolean;
  templates: ZaloTemplateSummary[];
  source: 'zalo' | 'configured';
  warning?: string;
  error?: string;
}

export interface ZaloTemplateDetailResponse {
  success: boolean;
  template?: ZaloTemplateDetail;
  error?: string;
}

export interface ZaloManualSendRequest {
  templateId: string;
  phone: string;
  templateData: Record<string, string | number>;
  clientRequestId: string;
}

export interface ZaloManualSendResponse {
  success: boolean;
  messageId?: string;
  logId?: string;
  trackingId?: string;
  alreadySent?: boolean;
  error?: string;
  errorCode?: string | number;
}
