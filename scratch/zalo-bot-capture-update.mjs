/**
 * Hỏi thẳng Zalo: tin nhắn bạn gửi cho bot có tới hệ thống Zalo không, và
 * payload THẬT có hình dạng gì.
 *
 * getUpdates và webhook loại trừ lẫn nhau, nên script tạm gỡ webhook, lắng nghe,
 * rồi ĐẶT LẠI trong finally — kể cả khi bạn Ctrl+C hay script lỗi.
 *
 *   node scratch/zalo-bot-capture-update.mjs
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
const token = process.env.ZALO_BOT_TOKEN || env.ZALO_BOT_TOKEN || '';
const secret = process.env.ZALO_BOT_WEBHOOK_SECRET || env.ZALO_BOT_WEBHOOK_SECRET || '';
const appUrl = (env.APP_URL || 'https://vps.thienuy.edu.vn').replace(/\/$/, '');
const webhookUrl = `${appUrl}/api/zalo-bot/webhook`;
const LISTEN_MS = Number(process.argv[2] || 120) * 1000;

if (!token || !secret) throw new Error('thiếu ZALO_BOT_TOKEN hoặc ZALO_BOT_WEBHOOK_SECRET');

async function bot(method, body = {}) {
  const res = await fetch(`https://bot-api.zaloplatforms.com/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 300) } };
  }
}

let restored = false;
async function restoreWebhook() {
  if (restored) return;
  restored = true;
  const back = await bot('setWebhook', { url: webhookUrl, secret_token: secret });
  console.log('\n--- Đặt lại webhook ---');
  console.log(JSON.stringify(back.json, null, 2));
  const info = await bot('getWebhookInfo');
  console.log('webhook hiện tại:', info.json?.result?.url || '(TRỐNG — ĐẶT LẠI THẤT BẠI)');
}

process.on('SIGINT', async () => {
  console.log('\nCtrl+C — đang đặt lại webhook...');
  await restoreWebhook();
  process.exit(130);
});

try {
  console.log('1. Gỡ webhook tạm thời...');
  console.log('  ', JSON.stringify((await bot('deleteWebhook')).json));

  console.log(`\n2. ĐANG LẮNG NGHE ${LISTEN_MS / 1000}s.`);
  console.log('   >>> BÂY GIỜ mở chat riêng với bot trong Zalo và gửi: /link ABCD1234');
  console.log('   (mã sai cũng được — mục đích chỉ để xem payload thật)\n');

  const deadline = Date.now() + LISTEN_MS;
  let seen = 0;
  while (Date.now() < deadline) {
    const res = await bot('getUpdates', { timeout: '20' });
    const result = res.json?.result;
    const items = Array.isArray(result) ? result : result ? [result] : [];
    for (const item of items) {
      seen++;
      console.log(`--- UPDATE #${seen} ---`);
      console.log(JSON.stringify(item, null, 2));
    }
    if (!items.length) process.stdout.write('.');
  }

  console.log(`\n\n3. Kết thúc. Nhận được ${seen} update.`);
  if (!seen) {
    console.log('   Zalo KHÔNG hề nhận được tin nào → vấn đề nằm ở phía Zalo/bot,');
    console.log('   không phải ở webhook hay code. Kiểm tra bạn có đang chat đúng bot không.');
  } else {
    console.log('   Zalo CÓ nhận tin. So hình dạng payload ở trên với zaloBotWebhookSchema');
    console.log('   trong server/api/zalo-bot/webhookHandler.ts:17.');
  }
} finally {
  await restoreWebhook();
}
