const crypto = require('crypto');

const DESTINATIONS = [
  { pixelId: '1052655347662889', tokenEnv: 'META_CAPI_TOKEN_JOAO' },
  { pixelId: '4323927661251100', tokenEnv: 'META_CAPI_TOKEN_ZENTRA' },
];

function sha256(value) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const phone = normalizePhone(payload.whatsapp);
  if (!phone) {
    return { statusCode: 400, body: 'Missing whatsapp' };
  }

  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];

  const eventTime = Math.floor(Date.now() / 1000);
  const userData = {
    ph: [sha256(phone)],
    client_ip_address: clientIp,
    client_user_agent: payload.user_agent,
    fbp: payload.fbp || undefined,
    fbc: payload.fbc || undefined,
  };

  const destinations = DESTINATIONS.filter((d) => process.env[d.tokenEnv]);
  if (destinations.length === 0) {
    return { statusCode: 500, body: 'No CAPI tokens configured' };
  }

  const results = await Promise.all(
    destinations.map(async ({ pixelId, tokenEnv }) => {
      const body = {
        data: [
          {
            event_name: 'Lead',
            event_time: eventTime,
            event_id: payload.event_id,
            action_source: 'website',
            event_source_url: payload.event_source_url || 'https://ogrupozentra.com/zclub',
            user_data: userData,
          },
        ],
      };

      const res = await fetch(`https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${process.env[tokenEnv]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return { pixelId, ok: res.ok, result: await res.json() };
    })
  );

  return {
    statusCode: results.every((r) => r.ok) ? 200 : 502,
    body: JSON.stringify(results),
  };
};
