/**
 * Gửi payload đúng hình dạng tài liệu Zalo vào webhook production.
 * chat_type=GROUP nên handler thoát ở webhookHandler.ts:92 TRƯỚC mọi ghi DocumentStore.
 * Không tạo marker, không tạo pending chat, không tiêu thụ mã.
 */
import { readFileSync, existsSync } from 'fs';

const ENV_FILE = '.vercel/.env.production.local';
const env = {};
if (existsSync(ENV_FILE)) {
  for (const m of readFileSync(ENV_FILE, 'utf8').matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm)) {
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    env[m[1]] = v;
  }
}
const secret = process.env.ZALO_BOT_WEBHOOK_SECRET || env.ZALO_BOT_WEBHOOK_SECRET || '';
const url = `${(env.APP_URL || 'https://vps.thienuy.edu.vn').replace(/\/$/, '')}/api/zalo-bot/webhook`;
if (!secret) throw new Error('thiếu ZALO_BOT_WEBHOOK_SECRET');

const payloads = {
  'đúng docs (GROUP, không ghi gì)': {
    ok: true,
    result: {
      event_name: 'message.text.received',
      message: {
        from: { id: '1234567890', display_name: 'Probe', is_bot: false },
        chat: { id: '9876543210', chat_type: 'GROUP' },
        text: 'hello',
        message_id: 'probe-msg-1',
        date: Date.now(),
      },
    },
  },
  'thiếu ok (giả thuyết: Zalo không gửi ok)': {
    result: {
      event_name: 'message.text.received',
      message: {
        from: { id: '1234567890', display_name: 'Probe' },
        chat: { id: '9876543210', chat_type: 'GROUP' },
        text: 'hello',
        message_id: 'probe-msg-2',
      },
    },
  },
  'id dạng số (giả thuyết: không phải string)': {
    ok: true,
    result: {
      event_name: 'message.text.received',
      message: {
        from: { id: 1234567890, display_name: 'Probe' },
        chat: { id: 9876543210, chat_type: 'GROUP' },
        text: 'hello',
        message_id: 12345,
      },
    },
  },
  'không bọc result (giả thuyết: message ở gốc)': {
    event_name: 'message.text.received',
    message: {
      from: { id: '1234567890', display_name: 'Probe' },
      chat: { id: '9876543210', chat_type: 'GROUP' },
      text: 'hello',
      message_id: 'probe-msg-4',
    },
  },
};

for (const [label, body] of Object.entries(payloads)) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(body),
  });
  const text = (await res.text()).slice(0, 120);
  console.log(`${String(res.status).padEnd(4)} ${label}`);
  console.log(`     ${text}`);
}
