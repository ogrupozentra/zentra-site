// CAPI server-side pro quiz /diagnostico (pixel Zentra).
// Mesmo event_id do fbq no navegador -> Meta deduplica.
const crypto = require('crypto');

const PIXEL_ID = '4323927661251100';
const ALLOWED_EVENTS = new Set(['PreDiagnostico', 'QuizInicio', 'Lead', 'Contact']);

const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const token = process.env.META_CAPI_TOKEN_ZENTRA;
  if (!token) return { statusCode: 500, body: 'Missing META_CAPI_TOKEN_ZENTRA' };

  let p;
  try {
    p = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!ALLOWED_EVENTS.has(p.event_name) || !p.event_id) {
    return { statusCode: 400, body: 'Invalid event' };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
  const phone = normalizePhone(p.phone);
  const nameParts = String(p.name || '').trim().split(/\s+/).filter(Boolean);

  const userData = {
    client_ip_address: ip,
    client_user_agent: p.user_agent || event.headers['user-agent'],
    fbp: p.fbp || undefined,
    fbc: p.fbc || undefined,
    external_id: p.codigo ? [sha256(p.codigo)] : undefined,
    ph: phone ? [sha256(phone)] : undefined,
    fn: nameParts[0] ? [sha256(nameParts[0])] : undefined,
    ln: nameParts.length > 1 ? [sha256(nameParts[nameParts.length - 1])] : undefined,
    country: [sha256('br')],
  };

  const body = {
    data: [
      {
        event_name: p.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(p.event_id).slice(0, 64),
        action_source: 'website',
        event_source_url: p.event_source_url || 'https://www.ogrupozentra.com/diagnostico/',
        user_data: userData,
        custom_data: {
          content_name: 'diagnostico-mentoria',
          utm_campaign: p.utm_campaign || undefined,
          utm_content: p.utm_content || undefined,
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
  if (!res.ok) console.error('CAPI error', JSON.stringify(result));

  return { statusCode: res.ok ? 200 : 502, body: JSON.stringify({ ok: res.ok }) };
};
