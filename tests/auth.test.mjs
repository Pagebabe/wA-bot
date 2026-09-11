import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { verifyBasicAuthorization } from '../dist/auth.js';

function settingsFor(password){
  const salt=randomBytes(16);
  const iterations=210000;
  const hash=pbkdf2Sync(password,salt,iterations,32,'sha256').toString('hex');
  return {admin_password_salt:salt.toString('hex'),admin_password_hash:hash,admin_password_iterations:iterations};
}
function basic(user,password){return 'Basic '+Buffer.from(`${user}:${password}`).toString('base64');}

test('Basic Auth accepts correct admin credentials',()=>{
  const s=settingsFor('admin');
  assert.equal(verifyBasicAuthorization(basic('admin','admin'),s),true);
});

test('Basic Auth rejects wrong user, wrong password and malformed headers',()=>{
  const s=settingsFor('admin');
  assert.equal(verifyBasicAuthorization(basic('operator','admin'),s),false);
  assert.equal(verifyBasicAuthorization(basic('admin','wrong'),s),false);
  assert.equal(verifyBasicAuthorization('Bearer x',s),false);
  assert.equal(verifyBasicAuthorization(undefined,s),false);
});
