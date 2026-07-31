const crypto = require('crypto');

const PIXEL_ID = '1052655347662889';

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

  const token = process.env.META_CAPI_TOKEN_JOAO;
  if (!token) {
    return { statusCode: 500, body: 'Missing META_CAPI_TOKEN_JOAO' };
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

  const body = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: payload.event_id,
        action_source: 'website',
        event_source_url: payload.event_source_url || 'https://ogrupozentra.com/zclub',
        user_data: {
          ph: [sha256(phone)],
          client_ip_address: clientIp,
          client_user_agent: payload.user_agent,
          fbp: payload.fbp || undefined,
          fbc: payload.fbc || undefined,
        },
      },
    ],
  };

  const res = await fetch(`https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  return {
    statusCode: res.ok ? 200 : 502,
    body: JSON.stringify(result),
  };
};
