import { jsonResponse, randomChallenge } from './passkey-utils.js';

export async function onRequest(context) {
  const { env } = context;
  if (!env.KV) {
    return jsonResponse(500, { error: 'KV binding not configured.' });
  }

  const credentialRaw = await env.KV.get('passkey:credential');
  if (!credentialRaw) {
    return jsonResponse(404, { error: 'No credential registered.' });
  }
  const credential = JSON.parse(credentialRaw);
  const challenge = randomChallenge();
  await env.KV.put('passkey:challenge:auth', challenge, { expirationTtl: 300 });

  const options = {
    challenge,
    timeout: 60000,
    rpId: env.RP_ID || new URL(context.request.url).hostname,
    allowCredentials: [ { id: credential.id, type: 'public-key' } ],
    userVerification: 'preferred'
  };

  return jsonResponse(200, options);
}
