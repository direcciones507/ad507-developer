import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export function passwordHash(password){if(typeof password!=='string'||password.length<16||password.length>1024)throw Error('PASSWORD_MIN_16_CHARACTERS');const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')}`;}
export function verify(password,stored){
  if(typeof password!=='string'||password.length>1024||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored||''))return false;
  const [,salt,hash]=stored.split(':');const expected=Buffer.from(hash,'hex');const bytes=Buffer.from(salt,'hex');const modern=scryptSync(password,bytes,64);const legacy=scryptSync(password,salt,64);return timingSafeEqual(modern,expected)|timingSafeEqual(legacy,expected)?true:false;
}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function createSession(store){const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');const expires=Date.now()+12*60*60*1000;
  store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());store.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),csrf,expires);return {token,csrf,expires};}
export function getSession(store,cookie,name){const token=(cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='))?.slice(name.length+1);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return store.db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(digest(token),Date.now())||null;}
