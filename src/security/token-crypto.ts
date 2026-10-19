import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

function keyBytes(encoded=env.TOKEN_ENCRYPTION_KEY): Buffer {
  if(!encoded) throw new Error('OAuth token encryption is not configured.');
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded) throw new Error('TOKEN_ENCRYPTION_KEY must be canonical base64 for exactly 32 random bytes.');
  return key;
}

export function encryptTokenWithKey(plaintext:string,encodedKey:string):string {
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',keyBytes(encodedKey),iv);
  const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTokenWithKey(value:string,encodedKey:string):string {
  try {
    const [version,ivText,tagText,dataText,...rest]=value.split('.');
    if(version!=='v1'||!ivText||!tagText||dataText===undefined||rest.length) throw new Error();
    const iv=Buffer.from(ivText,'base64url'); const tag=Buffer.from(tagText,'base64url'); const data=Buffer.from(dataText,'base64url');
    if(iv.length!==12||tag.length!==16) throw new Error();
    const decipher=createDecipheriv('aes-256-gcm',keyBytes(encodedKey),iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
  } catch { throw new Error('Stored Google credentials could not be decrypted. Check TOKEN_ENCRYPTION_KEY and reconnect if needed.'); }
}

export const encryptToken=(value:string)=>encryptTokenWithKey(value,env.TOKEN_ENCRYPTION_KEY??'');
export const decryptToken=(value:string)=>decryptTokenWithKey(value,env.TOKEN_ENCRYPTION_KEY??'');
