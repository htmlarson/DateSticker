import { jsonResponse, randomChallenge } from './passkey-utils.js';

export async function onRequest(context) {
  const { env } = context;
  if (!env.KV) {
    return jsonResponse(500, { error: 'KV binding not configured.' });
  }

  const challenge = randomChallenge();
  await env.KV.put('passkey:challenge:register', challenge, { expirationTtl: 300 });

  const rpId = env.RP_ID || new URL(context.request.url).hostname;
  const rp = { id: rpId, name: 'Change Count' };
  const user = { id: 'count-user', name: 'Count Admin', displayName: 'Count Admin' };

  const options = {
    rp,
    user,
    challenge,
    pubKeyCredParams: [ { type: 'public-key', alg: -7 } ],
    timeout: 60000,
    attestation: 'none'
  };

  return jsonResponse(200, options);
}
