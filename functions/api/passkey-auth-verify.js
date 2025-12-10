import { fromBase64Url, jsonResponse, parseClientData, verifyAssertionSignature } from './passkey-utils.js';

function unauthorized(message = 'Unauthorized') {
  return jsonResponse(401, { error: message });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.KV) {
    return jsonResponse(500, { error: 'KV binding not configured.' });
  }

  let credential;
  const storedCredential = await env.KV.get('passkey:credential');
  if (storedCredential) {
    credential = JSON.parse(storedCredential);
  }
  if (!credential) {
    return unauthorized('Credential missing.');
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const storedChallenge = await env.KV.get('passkey:challenge:auth');
  if (!storedChallenge) {
    return unauthorized('Authentication challenge expired.');
  }

  const { id, type, response } = payload || {};
  if (!id || type !== 'public-key' || !response?.clientDataJSON || !response?.authenticatorData || !response?.signature) {
    return jsonResponse(400, { error: 'Malformed assertion payload.' });
  }

  const clientDataJSON = fromBase64Url(response.clientDataJSON);
  const authData = fromBase64Url(response.authenticatorData);
  const signature = fromBase64Url(response.signature);

  const clientData = parseClientData(clientDataJSON);
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== storedChallenge) {
    return unauthorized('Invalid authentication response.');
  }

  const signatureValid = await verifyAssertionSignature(fromBase64Url(credential.publicKey), authData, clientDataJSON, signature);
  if (!signatureValid) {
    return unauthorized('Signature verification failed.');
  }

  await env.KV.put('passkey:challenge:auth', '', { expirationTtl: 1 });

  const sessionToken = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`passkey:session:${sessionToken}`, id, { expirationTtl: 604800 });

  return jsonResponse(200, { ok: true, token: sessionToken });
}
