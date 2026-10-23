// Password encryption for individual notes: AES-256-GCM with a key derived by scrypt.
// File format (UTF-8 JSON, extension .mdenc):
//   { "notesExplorer": "secure-note", "v": 1, "kdf": "scrypt", "N": 32768, "r": 8, "p": 1,
//     "salt": b64, "iv": b64, "tag": b64, "data": b64 }
// No `vscode` import, so it can be unit-tested with plain Node.
const crypto = require('crypto');

const MAGIC = 'secure-note';
const PARAMS = { N: 32768, r: 8, p: 1 };
const EXT = '.mdenc';

function deriveKey(password, salt, { N, r, p }) {
  // 128 * N * r bytes of memory; raise the limit just enough for these parameters
  return crypto.scryptSync(String(password).normalize('NFC'), salt, 32, { N, r, p, maxmem: 256 * N * r });
}

function encrypt(plainText, password) {
  if (!password) throw new Error('a password is required');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt, PARAMS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plainText, 'utf8')), cipher.final()]);
  return JSON.stringify({
    notesExplorer: MAGIC, v: 1, kdf: 'scrypt', ...PARAMS,
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
  }, null, 2) + '\n';
}

function isSecureNote(fileText) {
  try { return JSON.parse(fileText).notesExplorer === MAGIC; } catch { return false; }
}

/** Throws Error with code 'WRONG_PASSWORD' when the password is wrong or the file was tampered with. */
function decrypt(fileText, password) {
  let env;
  try { env = JSON.parse(fileText); } catch { throw Object.assign(new Error('not an encrypted note'), { code: 'NOT_SECURE' }); }
  if (env.notesExplorer !== MAGIC || env.v !== 1) throw Object.assign(new Error('not an encrypted note'), { code: 'NOT_SECURE' });
  const key = deriveKey(password, Buffer.from(env.salt, 'base64'), env);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('wrong password'), { code: 'WRONG_PASSWORD' });
  }
}

module.exports = { encrypt, decrypt, isSecureNote, EXT };
