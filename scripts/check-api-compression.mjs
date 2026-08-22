const baseUrl = process.env.BASE_URL || process.argv[2];
const token = process.env.ADMIN_TOKEN || process.env.API_TOKEN || process.argv[3] || '';

if (!baseUrl) {
  console.error(
    'Usage: BASE_URL=https://example.com ADMIN_TOKEN=ey... npm run check:api-compression'
  );
  process.exit(1);
}

const endpoints = [
  '/api/v1/health',
  '/api/v1/read/dashboard-aggregate?channel=dashboard-aggregate',
  '/api/v1/finance/report?startDate=2026-01-01&endDate=2026-01-31',
];

for (const endpoint of endpoints) {
  const url = new URL(endpoint, baseUrl).toString();
  const headers = {
    'Accept-Encoding': 'br,gzip',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(url, {
    headers,
  });
  const body = Buffer.from(await response.arrayBuffer());
  console.log(
    JSON.stringify({
      url,
      status: response.status,
      contentEncoding: response.headers.get('content-encoding') || '',
      contentLength: response.headers.get('content-length') || '',
      bytesReceived: body.length,
    })
  );
}
