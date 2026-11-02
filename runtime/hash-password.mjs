import { passwordHash } from './auth.mjs';
// Pipe from a password manager or read with terminal echo disabled; never pass a password as an argument.
let password='';for await(const chunk of process.stdin){password+=chunk;if(password.length>1025)throw Error('PASSWORD_TOO_LONG');}
console.log(passwordHash(password.replace(/\r?\n$/,'')));password='';
