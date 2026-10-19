import { describe,expect,it } from 'vitest';
import { decryptTokenWithKey, encryptTokenWithKey } from '../src/security/token-crypto.js';

const key=Buffer.alloc(32,7).toString('base64');
describe('OAuth token encryption',()=>{
  it('round trips encrypted credentials with authenticated AES-GCM',()=>{
    const encoded=encryptTokenWithKey('{"access_token":"example"}',key);
    expect(encoded).not.toContain('example');
    expect(decryptTokenWithKey(encoded,key)).toBe('{"access_token":"example"}');
  });
  it('rejects tampering and the wrong encryption key',()=>{
    const encoded=encryptTokenWithKey('private',key); const parts=encoded.split('.');
    parts[3]=`${parts[3]}AA`;
    expect(()=>decryptTokenWithKey(parts.join('.'),key)).toThrow(/could not be decrypted/);
    expect(()=>decryptTokenWithKey(encoded,Buffer.alloc(32,8).toString('base64'))).toThrow(/could not be decrypted/);
  });
  it('rejects invalid key lengths and encodings',()=>{
    expect(()=>encryptTokenWithKey('private',Buffer.alloc(16).toString('base64'))).toThrow(/exactly 32/);
    expect(()=>encryptTokenWithKey('private','not-base64')).toThrow(/exactly 32/);
  });
});
