import { decodeCbor, fromBase64Url, jsonResponse, parseAuthData, parseClientData, toBase64Url } from './passkey-utils.js';

async function persistCredential(env, credential) {
  await env.KV.put('passkey:credential', JSON.stringify(credential));
}

function unauthorized(message = 'Unauthorized') {
  return jsonResponse(401, { error: message });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.KV) {
    return jsonResponse(500, { error: 'KV binding not configured.' });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return jsonResponse(400, { error: 'Invalid JSON body.' });
  }

  const storedChallenge = await env.KV.get('passkey:challenge:register');
  if (!storedChallenge) {
    return unauthorized('Registration challenge expired.');
  }

  const { id, type, response } = payload || {};
  if (!id || type !== 'public-key' || !response?.attestationObject || !response?.clientDataJSON) {
    return jsonResponse(400, { error: 'Malformed credential payload.' });
  }

  const clientDataBytes = fromBase64Url(response.clientDataJSON);
  const clientData = parseClientData(clientDataBytes);
  if (clientData.type !== 'webauthn.create' || clientData.challenge !== storedChallenge) {
    return unauthorized('Invalid registration response.');
  }

  const attestationBytes = fromBase64Url(response.attestationObject);
  const { authData } = decodeCbor(attestationBytes);
  const authInfo = parseAuthData(authData);
  if (!authInfo.credentialId || !authInfo.credentialPublicKey) {
    return jsonResponse(400, { error: 'Credential data missing in attestation.' });
  }

  const credentialRecord = {
    id,
    publicKey: toBase64Url(authInfo.credentialPublicKey),
    signCount: authInfo.signCount
  };

  await persistCredential(env, credentialRecord);
  await env.KV.delete('passkey:challenge:register');

  const sessionToken = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`passkey:session:${sessionToken}`, id, { expirationTtl: 604800 });

  return jsonResponse(200, { ok: true, token: sessionToken });
}
