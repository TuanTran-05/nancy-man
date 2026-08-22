/**
 * Zalo Bot webhook doctor.
 *
 * Chẩn đoán (mặc định) — không ghi gì vào DocumentStore, không gửi tin nào:
 *   ZALO_BOT_TOKEN=xxx ZALO_BOT_WEBHOOK_SECRET=yyy node scratch/zalo-bot-webhook-doctor.mjs
 *
 * Đăng ký lại webhook (chỉ chạy sau khi đã đọc kết luận):
 *   ZALO_BOT_TOKEN=xxx ZALO_BOT_WEBHOOK_SECRET=yyy node scratch/zalo-bot-webhook-doctor.mjs --set
 *
 * Không bao giờ in token hay secret ra màn hình.
 */

import { readFileSync, existsSync } from 'fs';

const BASE = 'https://bot-api.zaloplatforms.com';

/**
 * Đọc file env do `vercel env pull` sinh ra, giữ nguyên từng byte của giá trị.
 * Cố tình KHÔNG trim: khoảng trắng thừa chính là thứ đang bị nghi ngờ.
 */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const [, key, rawValue] of readFileSync(path, 'utf8').matchAll(
    /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm
  )) {
    let value = rawValue;
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
    out[key] = value;
  }
  return out;
}

const ENV_FILE = process.env.ZALO_BOT_ENV_FILE || '.vercel/.env.production.local';
const fileEnv = loadEnvFile(ENV_FILE);
const envSource = Object.keys(fileEnv).length ? ENV_FILE : 'process.env';
const readEnv = (name) => process.env[name] ?? fileEnv[name] ?? '';

console.log(`Nguồn biến môi trường: ${envSource}\n`);

const token = readEnv('ZALO_BOT_TOKEN');
const secret = readEnv('ZALO_BOT_WEBHOOK_SECRET');
const appUrl = (readEnv('APP_URL') || 'https://vps.thienuy.edu.vn').replace(/\/$/, '');
const expectedWebhook = `${appUrl}/api/zalo-bot/webhook`;
const shouldSet = process.argv.includes('--set');

if (!token) {
  console.error(`Thiếu ZALO_BOT_TOKEN (đã tìm trong ${ENV_FILE} và process.env).`);
  console.error('Chạy: vercel env pull .vercel/.env.production.local --environment=production');
  process.exit(1);
}

async function bot(method, body = {}) {
  const res = await fetch(`${BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 500) } };
  }
}

function line(label, value) {
  console.log(`  ${String(label).padEnd(24)} ${value}`);
}

// Trailing whitespace/newline is invisible in a dashboard field but breaks the
// byte-for-byte comparison the webhook does. Report it before anything else.
console.log('=== 0. Secret bạn đưa cho script này ===');
if (!secret) {
  line('ZALO_BOT_WEBHOOK_SECRET', '(chưa đặt — bỏ qua phần kiểm tra phía server)');
} else {
  line('độ dài', secret.length);
  line('khoảng trắng thừa', secret !== secret.trim() ? '>>> CÓ, đây là lỗi <<<' : 'không');
  line('trong khoảng 8-256', secret.length >= 8 && secret.length <= 256 ? 'ok' : '>>> SAI <<<');
}

console.log('\n=== 1. getMe — token còn sống? ===');
const me = await bot('getMe');
line('http', me.status);
console.log(JSON.stringify(me.json, null, 2));

console.log('\n=== 2. getWebhookInfo — Zalo đang giữ URL nào? ===');
const info = await bot('getWebhookInfo');
line('http', info.status);
console.log(JSON.stringify(info.json, null, 2));
const registeredUrl = info.json?.result?.url || '';
line('mong đợi', expectedWebhook);
line('thực tế', registeredUrl || '(trống)');
line('khớp', registeredUrl === expectedWebhook ? 'ĐÚNG' : '>>> LỆCH <<<');

// Probe A — phía chúng ta. Body {} qua được cửa secret rồi mới trượt schema,
// nên 400 chứng minh secret khớp mà không tạo bản ghi nào trong DocumentStore.
console.log('\n=== 3. Probe A: secret trong Vercel có đúng bằng secret của bạn không? ===');
if (!secret) {
  console.log('  Bỏ qua: chưa có ZALO_BOT_WEBHOOK_SECRET.');
} else {
  const res = await fetch(expectedWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({}),
  });
  const body = (await res.text()).slice(0, 200);
  line('http', res.status);
  line('body', body);
  if (res.status === 400) {
    line('kết luận', 'SECRET KHỚP — qua được cửa xác thực, chỉ trượt schema như dự kiến.');
  } else if (res.status === 403) {
    line('kết luận', '>>> SECRET LỆCH: giá trị trong Vercel khác giá trị bạn vừa đưa. <<<');
  } else {
    line('kết luận', 'Ngoài dự kiến — xem body ở trên.');
  }
}

// Probe B — phía Zalo. Zalo tự gọi endpoint bằng secret nó đang lưu.
console.log('\n=== 4. Probe B: Zalo gọi endpoint thì nhận được gì? ===');
const test = await bot('testWebhook');
line('http', test.status);
console.log(JSON.stringify(test.json, null, 2));
const seen = test.json?.result?.status_code;
if (seen === 400) {
  line('kết luận', 'Secret Zalo đang lưu KHỚP với Vercel. Cửa xác thực không phải thủ phạm.');
} else if (seen === 403) {
  line('kết luận', '>>> Zalo bị chặn 403: secret_token bên Zalo lệch, hoặc Vercel Firewall chặn. <<<');
} else if (seen === 200) {
  line('kết luận', 'Endpoint trả 200 cho ping của Zalo.');
} else {
  line('kết luận', `Zalo thấy status ${seen} — xem hint ở trên.`);
}

console.log('\n=== 5. Đối chiếu A và B ===');
console.log('  A=400, B=400  → hai đầu khớp nhau; lỗi nằm sau cửa xác thực (schema/không nhận update).');
console.log('  A=400, B=403  → Vercel đúng, Zalo sai: chạy lại script với --set.');
console.log('  A=403         → giá trị trong Vercel không phải cái bạn nghĩ: sửa env rồi redeploy.');

if (shouldSet) {
  console.log('\n=== 6. setWebhook ===');
  if (!secret) {
    console.error('Cần ZALO_BOT_WEBHOOK_SECRET, đúng bằng giá trị đang đặt trong Vercel.');
    process.exit(1);
  }
  // Gửi đúng từng byte mà server sẽ đem ra so sánh. Trim ở đây sẽ tự tạo ra
  // lệch nếu giá trị trong Vercel có khoảng trắng thừa.
  const set = await bot('setWebhook', { url: expectedWebhook, secret_token: secret });
  line('http', set.status);
  console.log(JSON.stringify(set.json, null, 2));
}
