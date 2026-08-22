const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
if (!secret) {
  console.error('TURNSTILE_SECRET_KEY is missing');
  process.exit(2);
}

const body = new URLSearchParams({
  secret,
  response: 'edutrack-invalid-preflight-token',
});
const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
  method: 'POST',
  body,
});
const result = await response.json();
const errorCodes = Array.isArray(result['error-codes']) ? result['error-codes'] : [];

if (!response.ok) {
  console.error(`Turnstile siteverify HTTP ${response.status}`);
  process.exit(1);
}
if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('missing-input-secret')) {
  console.error('Turnstile rejected the configured secret');
  process.exit(1);
}
if (!errorCodes.includes('invalid-input-response')) {
  console.error(`Unexpected Turnstile preflight response: ${JSON.stringify(result)}`);
  process.exit(1);
}

console.log('Turnstile accepted the configured secret and rejected the synthetic response token');
