const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {stripTypeScriptTypes}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const token='fixture-session';
async function fixture(){
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec(`CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE erabiltzaileak(id_erabiltzailea integer PRIMARY KEY,izena text UNIQUE,pasahitza text);
    CREATE TABLE api_sessions(token_hash text PRIMARY KEY,user_id integer REFERENCES erabiltzaileak,expires_at double precision);
    CREATE TABLE owned_data(user_id integer REFERENCES erabiltzaileak,content text);
    INSERT INTO erabiltzaileak VALUES(1,'coach',extensions.crypt('old-password',extensions.gen_salt('bf',4))),
      (2,'reserved',extensions.crypt('other-password',extensions.gen_salt('bf',4))),
      (3,'legacy-sha',encode(extensions.digest('legacy-password','sha256'),'hex')),(4,'legacy-text','legacy-password');
    INSERT INTO owned_data VALUES(1,'Team, exercises and linked player');`);
  for(const [key,user,expiry] of [[token,1,'Infinity'],['other-device',1,'Infinity'],['other-user',2,'Infinity'],['sha-session',3,'Infinity'],['text-session',4,'Infinity']]){
    await db.query('INSERT INTO api_sessions VALUES($1,$2,$3::double precision)',[hash(key),user,expiry]);
  }
  await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261114100000_account_credentials.sql'),'utf8'));
  return db;
}
function update(db,options={}){
  const args={user:1,session:token,current:'old-password',expected:'coach',username:'coach-renamed',password:null,...options};
  return db.query('SELECT update_account_credentials($1,$2,$3,$4,$5,$6) AS result',
    [args.user,hash(args.session),args.current,args.expected,args.username,args.password]);
}

test('account rename and password change verify credentials, preserve ownership and revoke only other sessions',async()=>{
  const db=await fixture();
  try{
    for(const [options,code] of [[{current:'wrong-password'},'28000'],[{username:'RESERVED'},'23505'],[{expected:'stale'},'40001'],[{session:'other-user'},'42501'],[{user:2,current:'old-password'},'42501']]){
      await assert.rejects(update(db,options),{code});
    }
    assert.equal((await db.query('SELECT izena FROM erabiltzaileak WHERE id_erabiltzailea=1')).rows[0].izena,'coach');
    const renamed=(await update(db,{username:'  New-Coach  '})).rows[0].result;
    assert.deepEqual(renamed,{ok:true,user:{id_erabiltzailea:1,izena:'new-coach'}});
    assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=1')).rows.length,2);
    const changed=(await update(db,{expected:'new-coach',username:'new-coach',password:'new-password'})).rows[0].result;
    assert.equal(changed.user.izena,'new-coach');assert(!JSON.stringify(changed).includes('password'));
    const stored=(await db.query('SELECT pasahitza,extensions.crypt($1,pasahitza)=pasahitza AS new_valid,extensions.crypt($2,pasahitza)=pasahitza AS old_valid FROM erabiltzaileak WHERE id_erabiltzailea=1',['new-password','old-password'])).rows[0];
    assert.equal(stored.new_valid,true);assert.equal(stored.old_valid,false);assert.notEqual(stored.pasahitza,'new-password');
    assert.deepEqual((await db.query('SELECT token_hash,expires_at::text AS expiry FROM api_sessions WHERE user_id=1')).rows,[{token_hash:hash(token),expiry:'Infinity'}]);
    assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=2')).rows.length,1);
    assert.equal((await db.query('SELECT content FROM owned_data WHERE user_id=1')).rows[0].content,'Team, exercises and linked player');
    const permissions=(await db.query("SELECT has_function_privilege('anon','update_account_credentials(integer,text,text,text,text,text)','EXECUTE') AS anon,has_function_privilege('authenticated','update_account_credentials(integer,text,text,text,text,text)','EXECUTE') AS authenticated,has_function_privilege('service_role','update_account_credentials(integer,text,text,text,text,text)','EXECUTE') AS service")).rows[0];
    assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
  }finally{await db.close();}
});

test('legacy passwords, invalid input, expired sessions and partial failures are handled atomically',async()=>{
  const db=await fixture();
  try{
    for(const [user,session,name] of [[3,'sha-session','legacy-sha'],[4,'text-session','legacy-text']]){
      await update(db,{user,session,current:'legacy-password',expected:name,username:name+'-renamed',password:'new-password'});
    }
    for(const options of [{username:'x'},{password:'short'},{password:'é'.repeat(37)},{current:''}]){
      await assert.rejects(update(db,options),{code:'22023'});
    }
    await db.exec(`CREATE FUNCTION fail_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Storage failure'; END $$;
      CREATE TRIGGER fail_session_delete BEFORE DELETE ON api_sessions FOR EACH ROW EXECUTE FUNCTION fail_session_delete();`);
    await assert.rejects(update(db,{password:'new-password'}),/Storage failure/);
    assert.equal((await db.query('SELECT izena FROM erabiltzaileak WHERE id_erabiltzailea=1')).rows[0].izena,'coach');
    assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=1')).rows.length,2);
    await db.exec('UPDATE api_sessions SET expires_at=0 WHERE user_id=1');
    await assert.rejects(update(db),{code:'42501'});
  }finally{await db.close();}
});

test('account gateway uses session identity, validates input and returns safe errors and fields',async()=>{
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../account-actions.ts'),'utf8'))
    .replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
  const context={crypto:crypto.webcrypto,TextEncoder,Uint8Array};vm.createContext(context);vm.runInContext(source+'\nthis.handle=handleAccountAction;',context);
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return{data:{ok:true,user:{id_erabiltzailea:1,izena:args.p_username}}};}};
  const respond=(status,body)=>({status,body});
  const payload={action:'account_update',username:' New-Coach ',expected_username:'coach',current_password:'old-password',new_password:'new-password',user_id:2,session_hash:hash('other-user')};
  const result=await context.handle(payload,db,1,token,respond);assert.equal(result.status,200);
  assert.equal(calls[0].args.p_user_id,1);assert.equal(calls[0].args.p_session_hash,hash(token));assert.equal(calls[0].args.p_username,'new-coach');
  for(const change of [{username:'x'},{current_password:null},{new_password:'short'},{new_password:'é'.repeat(37)},{expected_username:null}]){
    assert.equal((await context.handle({...payload,...change},db,1,token,respond)).status,400);
  }
  assert.equal(calls.length,1);
  for(const [code,status] of [['28000',403],['23505',409],['40001',409],['42501',401],['XX000',500]]){
    db.rpc=async()=>({error:{code,message:'private storage detail'}});
    const failure=await context.handle(payload,db,1,token,respond);assert.equal(failure.status,status);assert(!JSON.stringify(failure).includes('private storage detail'));
  }
});
