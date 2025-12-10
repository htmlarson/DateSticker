const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

export function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  const binary = atob(normalized + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function randomChallenge(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes.buffer);
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'CDN-Cache-Control': 'no-store'
    }
  });
}

function decodeItem(dataView, offset) {
  const first = dataView.getUint8(offset);
  const major = first >> 5;
  const additional = first & 0x1f;
  let len = 0;
  let value;
  offset += 1;

  function readLength(additionalInfo) {
    if (additionalInfo < 24) return { length: additionalInfo, offset };
    if (additionalInfo === 24) return { length: dataView.getUint8(offset), offset: offset + 1 };
    if (additionalInfo === 25) return { length: dataView.getUint16(offset), offset: offset + 2 };
    if (additionalInfo === 26) return { length: dataView.getUint32(offset), offset: offset + 4 };
    throw new Error('Unsupported CBOR length encoding');
  }

  switch (major) {
    case 0: { // unsigned int
      const info = readLength(additional);
      value = info.length;
      offset = info.offset;
      return { value, offset };
    }
    case 1: { // negative int
      const info = readLength(additional);
      value = -1 - info.length;
      offset = info.offset;
      return { value, offset };
    }
    case 2: { // byte string
      const info = readLength(additional);
      const end = info.offset + info.length;
      value = dataView.buffer.slice(info.offset, end);
      return { value, offset: end };
    }
    case 3: { // text string
      const info = readLength(additional);
      const end = info.offset + info.length;
      const bytes = new Uint8Array(dataView.buffer.slice(info.offset, end));
      value = decoder.decode(bytes);
      return { value, offset: end };
    }
    case 4: { // array
      const info = readLength(additional);
      offset = info.offset;
      value = [];
      for (let i = 0; i < info.length; i++) {
        const item = decodeItem(dataView, offset);
        value.push(item.value);
        offset = item.offset;
      }
      return { value, offset };
    }
    case 5: { // map
      const info = readLength(additional);
      offset = info.offset;
      value = {};
      for (let i = 0; i < info.length; i++) {
        const key = decodeItem(dataView, offset);
        offset = key.offset;
        const val = decodeItem(dataView, offset);
        offset = val.offset;
        value[key.value] = val.value;
      }
      return { value, offset };
    }
    default:
      throw new Error('Unsupported CBOR major type ' + major);
  }
}

export function decodeCbor(buffer) {
  const dataView = new DataView(buffer);
  const { value } = decodeItem(dataView, 0);
  return value;
}

export function parseAuthData(buffer) {
  const view = new DataView(buffer);
  const rpIdHash = buffer.slice(0, 32);
  const flags = view.getUint8(32);
  const signCount = view.getUint32(33, false);
  let offset = 37;
  let credentialId;
  let credentialPublicKey;

  const attestedCredentialData = (flags & 0x40) !== 0;
  if (attestedCredentialData) {
    offset += 16; // skip AAGUID
    const credIdLen = view.getUint16(offset, false);
    offset += 2;
    credentialId = buffer.slice(offset, offset + credIdLen);
    offset += credIdLen;
    const pkBytes = buffer.slice(offset);
    credentialPublicKey = pkBytes;
  }

  return { rpIdHash, flags, signCount, credentialId, credentialPublicKey };
}

function coseToRawEcKey(coseKey) {
  const keyStruct = decodeCbor(coseKey);
  const x = keyStruct[-2];
  const y = keyStruct[-3];
  if (!x || !y) {
    throw new Error('Invalid COSE key');
  }
  const raw = new Uint8Array(1 + x.byteLength + y.byteLength);
  raw[0] = 0x04; // uncompressed point
  raw.set(new Uint8Array(x), 1);
  raw.set(new Uint8Array(y), 1 + x.byteLength);
  return raw.buffer;
}

export async function importPublicKey(coseKey) {
  const rawKey = coseToRawEcKey(coseKey);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

export async function verifyAssertionSignature(publicKeyCose, authenticatorData, clientDataJSON, signature) {
  const key = await importPublicKey(publicKeyCose);
  const clientHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
  const verificationBuffer = new Uint8Array(authenticatorData.byteLength + clientHash.byteLength);
  verificationBuffer.set(new Uint8Array(authenticatorData), 0);
  verificationBuffer.set(new Uint8Array(clientHash), authenticatorData.byteLength);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    signature,
    verificationBuffer
  );
}

export function parseClientData(clientDataBuffer) {
  const text = decoder.decode(new Uint8Array(clientDataBuffer));
  return JSON.parse(text);
}

export function concatUint8(...buffers) {
  const total = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  buffers.forEach((buf) => {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  });
  return out.buffer;
}
