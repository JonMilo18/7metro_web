const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE erabiltzaileak(id_erabiltzailea integer PRIMARY KEY,izena text UNIQUE,pasahitza text);
 CREATE TABLE api_sessions(token_hash text PRIMARY KEY,user_id integer,expires_at double precision);
 CREATE TABLE taldeak(id_taldea integer PRIMARY KEY,izena text,id_erabiltzailea integer NOT NULL REFERENCES erabiltzaileak);
 CREATE TABLE team_memberships(team_id integer REFERENCES taldeak ON DELETE CASCADE,user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE,role text,created_at timestamptz,PRIMARY KEY(team_id,user_id));
 CREATE TABLE team_invitations(team_id integer REFERENCES taldeak ON DELETE CASCADE,invited_user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE,invited_by integer REFERENCES erabiltzaileak ON DELETE CASCADE,created_at timestamptz,UNIQUE(team_id,invited_user_id));
 CREATE TABLE ariketak(id_ariketa integer PRIMARY KEY,id_erabiltzailea integer REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak ON DELETE SET NULL,izena text);
 CREATE TABLE plangintzak(id_plangintza integer PRIMARY KEY,id_erabiltzailea integer NOT NULL REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak);
 CREATE TABLE makrozikloak(id_makro integer PRIMARY KEY,id_erabiltzailea integer NOT NULL,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE mikrozikloak(id_mikroziklo integer PRIMARY KEY,id_erabiltzailea integer NOT NULL,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE jokalariak(id_jokalaria integer PRIMARY KEY,id_erabiltzailea integer REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE saioak(id_saio integer PRIMARY KEY,id_erabiltzailea integer REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE partidak(id_partida integer PRIMARY KEY,id_erabiltzailea integer NOT NULL,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE txapelketak(id_txapelketa integer PRIMARY KEY,id_erabiltzailea integer REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE progresioak(id_progresio integer PRIMARY KEY,id_erabiltzailea integer REFERENCES erabiltzaileak,id_taldea integer REFERENCES taldeak ON DELETE SET NULL);
 CREATE TABLE saio_xehetasuna(id_saio integer REFERENCES saioak ON DELETE CASCADE,id_ariketa integer REFERENCES ariketak ON DELETE CASCADE,aldaerak text);
 CREATE TABLE progresioak_has_ariketak(progresioak_id_progresio integer REFERENCES progresioak ON DELETE CASCADE,ariketak_id_ariketa integer REFERENCES ariketak ON DELETE CASCADE);
 CREATE TABLE saio_plangintzak(id_saio integer,id_plangintza integer);
 CREATE TABLE partida_plangintzak(id_partida integer,id_plangintza integer);
 CREATE TABLE portal_event_responses(user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE,kind text,event_id integer);
 CREATE TABLE portal_player_links(user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE,player_id integer REFERENCES jokalariak ON DELETE CASCADE);
 CREATE TABLE exercise_saves(exercise_id integer REFERENCES ariketak ON DELETE CASCADE,saved_by integer REFERENCES erabiltzaileak ON DELETE CASCADE);
 CREATE TABLE push_subscriptions(user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE);
 CREATE TABLE notification_inbox(user_id integer REFERENCES erabiltzaileak ON DELETE CASCADE);
 CREATE FUNCTION delete_team_owned(p_team_id integer,p_owner_id integer) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM taldeak WHERE id_taldea=p_team_id AND id_erabiltzailea=p_owner_id)
   OR NOT EXISTS(SELECT 1 FROM team_memberships WHERE team_id=p_team_id AND user_id=p_owner_id AND role='owner') THEN RAISE EXCEPTION 'Denied';END IF;
  DELETE FROM saio_plangintzak WHERE id_saio IN(SELECT id_saio FROM saioak WHERE id_taldea=p_team_id) OR id_plangintza IN(SELECT id_plangintza FROM plangintzak WHERE id_taldea=p_team_id);
  DELETE FROM partida_plangintzak WHERE id_partida IN(SELECT id_partida FROM partidak WHERE id_taldea=p_team_id) OR id_plangintza IN(SELECT id_plangintza FROM plangintzak WHERE id_taldea=p_team_id);
  DELETE FROM partidak WHERE id_taldea=p_team_id;DELETE FROM saioak WHERE id_taldea=p_team_id;
  DELETE FROM txapelketak WHERE id_taldea=p_team_id;DELETE FROM mikrozikloak WHERE id_taldea=p_team_id;
  DELETE FROM makrozikloak WHERE id_taldea=p_team_id;DELETE FROM plangintzak WHERE id_taldea=p_team_id;
  DELETE FROM progresioak WHERE id_taldea=p_team_id;DELETE FROM ariketak WHERE id_taldea=p_team_id;
  DELETE FROM jokalariak WHERE id_taldea=p_team_id;DELETE FROM taldeak WHERE id_taldea=p_team_id;
 END $$;
 INSERT INTO erabiltzaileak SELECT n,'user'||n,extensions.crypt('fixture-password',extensions.gen_salt('bf',4)) FROM generate_series(1,5) n;
 INSERT INTO taldeak VALUES(7,'Shared',1),(8,'Solo',1),(9,'Other owner',5),(10,'Former first recipient',1);
 INSERT INTO team_memberships VALUES(7,1,'owner','2026-01-01'),(7,2,'editor','2026-01-05'),(7,3,'editor','2026-01-03'),
   (8,1,'owner','2026-01-01'),(9,5,'owner','2026-01-01'),(9,1,'editor','2026-01-01'),(10,1,'owner','2026-01-01'),(10,3,'editor','2026-01-01');
 INSERT INTO team_invitations VALUES(7,2,1,'2026-01-01'),(7,3,1,'2026-01-02'),(7,4,1,'2025-01-01'),(10,4,1,'2025-01-01');
 INSERT INTO ariketak VALUES(1,1,7,'Shared drill'),(2,1,NULL,'Private unused'),(3,1,8,'Used by other team'),(4,1,NULL,'Private session drill'),(5,2,8,'Another user library'),(6,1,NULL,'Saved by another user');
 INSERT INTO saioak VALUES(100,1,7),(101,1,9),(102,2,8),(103,5,9),(104,1,NULL);
 INSERT INTO saio_xehetasuna VALUES(100,1,'Keep notes'),(101,1,'Keep notes 2'),(102,5,'Solo'),(103,3,'Protect cross-team reference'),(104,4,'Private');
 INSERT INTO exercise_saves VALUES(6,2);
 INSERT INTO plangintzak VALUES(1,1,7),(2,1,8);INSERT INTO saio_plangintzak VALUES(100,1),(102,2);
 INSERT INTO makrozikloak VALUES(1,1,7);INSERT INTO mikrozikloak VALUES(1,1,7);
 INSERT INTO jokalariak VALUES(1,5,9);INSERT INTO portal_player_links VALUES(1,1);
 INSERT INTO portal_event_responses VALUES(1,'session',101),(2,'session',102);
 INSERT INTO push_subscriptions VALUES(1),(2);INSERT INTO notification_inbox VALUES(1),(2);`);
 for(const [token,user]of[['self',1],['second-device',1],['other',2]])await db.query("INSERT INTO api_sessions VALUES($1,$2,'Infinity'::double precision)",[hash(token),user]);
 for(const migration of ['20261114100000_account_credentials.sql','20261114110000_delete_account.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',migration),'utf8'));
 return db;
}
async function call(db,action,payload={},user=1,token='self'){
 return(await db.query('SELECT account_deletion_action($1,$2,$3,$4::jsonb) AS result',[user,hash(token),action,JSON.stringify(payload)])).rows[0].result;
}

test('account deletion transfers to the first remaining invited member and preserves shared training data',async()=>{
 const db=await fixture();try{
  const result=await call(db,'account_delete_preview');const preview=result.preview;
  assert.equal(preview.owned_teams.find(t=>t.id===7).recipient_id,2);
  assert.equal(preview.owned_teams.find(t=>t.id===10).recipient_id,3);
  assert.equal(preview.owned_teams.find(t=>t.id===8).recipient_id,null);
  assert(!JSON.stringify(result).includes('pasahitza'));
  await call(db,'account_delete',{confirmation:'user1',current_password:'fixture-password',preview});
  assert.equal((await db.query('SELECT * FROM erabiltzaileak WHERE id_erabiltzailea=1')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=1')).rows.length,0);
  assert.deepEqual((await db.query('SELECT id_taldea,id_erabiltzailea FROM taldeak ORDER BY id_taldea')).rows,[{id_taldea:7,id_erabiltzailea:2},{id_taldea:9,id_erabiltzailea:5},{id_taldea:10,id_erabiltzailea:3}]);
  assert.equal((await db.query('SELECT role FROM team_memberships WHERE team_id=7 AND user_id=2')).rows[0].role,'owner');
  assert.deepEqual((await db.query('SELECT id_saio,id_erabiltzailea FROM saioak ORDER BY id_saio')).rows,[{id_saio:100,id_erabiltzailea:2},{id_saio:101,id_erabiltzailea:5},{id_saio:103,id_erabiltzailea:5}]);
  assert.equal((await db.query('SELECT * FROM saio_xehetasuna')).rows.length,3);
  assert.equal((await db.query('SELECT id_erabiltzailea FROM ariketak WHERE id_ariketa=1')).rows[0].id_erabiltzailea,null);
  assert.equal((await db.query('SELECT id_erabiltzailea FROM ariketak WHERE id_ariketa=3')).rows[0].id_erabiltzailea,null);
  assert.deepEqual((await db.query('SELECT id_ariketa FROM ariketak ORDER BY id_ariketa')).rows.map(r=>r.id_ariketa),[1,3,5,6]);
  for(const table of ['team_memberships','portal_player_links','portal_event_responses','push_subscriptions','notification_inbox'])assert.equal((await db.query('SELECT * FROM '+table+' WHERE user_id=1')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM jokalariak')).rows.length,1);
  assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=2')).rows.length,1);
  await assert.rejects(call(db,'account_delete_preview'),{code:'42501'});
 }finally{await db.close();}
});

test('account deletion verifies session, password, typed name and current team preview and rolls back failures',async()=>{
 const db=await fixture();try{
  const preview=(await call(db,'account_delete_preview')).preview;
  const payload={confirmation:'user1',current_password:'fixture-password',preview};
  await assert.rejects(call(db,'account_delete_preview',{},1,'other'),{code:'42501'});
  await assert.rejects(call(db,'account_delete',{...payload,confirmation:'user2'}),{code:'22023'});
  await assert.rejects(call(db,'account_delete',{...payload,current_password:'incorrect'}),{code:'28000'});
  await db.exec("INSERT INTO team_memberships VALUES(7,4,'editor',now())");
  await assert.rejects(call(db,'account_delete',payload),{code:'40001'});
  await db.exec('DELETE FROM team_memberships WHERE team_id=7 AND user_id=4');
  await db.exec(`CREATE FUNCTION fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id_erabiltzailea=1 THEN RAISE EXCEPTION 'Storage failure';END IF;RETURN OLD;END $$;
    CREATE TRIGGER fail_delete BEFORE DELETE ON erabiltzaileak FOR EACH ROW EXECUTE FUNCTION fail_delete();`);
  await assert.rejects(call(db,'account_delete',payload),/Storage failure/);
  assert.equal((await db.query('SELECT id_erabiltzailea FROM taldeak WHERE id_taldea=7')).rows[0].id_erabiltzailea,1);
  assert.equal((await db.query('SELECT * FROM taldeak WHERE id_taldea=8')).rows.length,1);
  assert.equal((await db.query('SELECT * FROM api_sessions WHERE user_id=1')).rows.length,2);
  assert.equal((await db.query('SELECT * FROM ariketak')).rows.length,6);
  assert.equal((await db.query("SELECT has_function_privilege('anon','account_deletion_action(integer,text,text,jsonb)','EXECUTE') AS allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('deletion gateway passes authenticated identity and hides database failures',async()=>{
 const context={crypto:crypto.webcrypto,TextEncoder,Uint8Array};vm.createContext(context);
 const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../account-actions.ts'),'utf8')).replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 vm.runInContext(source+'\nthis.handle=handleAccountAction;',context);
 let args;const client={rpc:async(name,payload)=>{assert.equal(name,'account_deletion_action');args=payload;return{data:{ok:true}};}};
 const respond=(status,body)=>({status,body});
 const payload={action:'account_delete',confirmation:'user1',current_password:'fixture-password',preview:{},user_id:2};
 assert.equal((await context.handle(payload,client,1,'self',respond)).status,200);assert.equal(args.p_user_id,1);assert.equal(args.p_session_hash,hash('self'));
 assert.equal((await context.handle({...payload,current_password:''},client,1,'self',respond)).status,400);
 client.rpc=async()=>({error:{code:'XX000',message:'Private error'}});
 const error=await context.handle(payload,client,1,'self',respond);assert.equal(error.status,500);assert(!JSON.stringify(error).includes('Private'));
});

test('players and legacy accounts with no owned team can delete their account without deleting another team',async()=>{
 const db=await fixture();try{
  await db.exec("UPDATE erabiltzaileak SET pasahitza=encode(extensions.digest('fixture-password','sha256'),'hex') WHERE id_erabiltzailea=3;UPDATE erabiltzaileak SET pasahitza='fixture-password' WHERE id_erabiltzailea=4;");
  for(const user of [3,4]){
   const token='legacy'+user;await db.query("INSERT INTO api_sessions VALUES($1,$2,'Infinity'::double precision)",[hash(token),user]);
   const preview=(await call(db,'account_delete_preview',{},user,token)).preview;
   assert.deepEqual(preview.owned_teams,[]);
   await call(db,'account_delete',{confirmation:'user'+user,current_password:'fixture-password',preview},user,token);
   assert.equal((await db.query('SELECT * FROM erabiltzaileak WHERE id_erabiltzailea=$1',[user])).rows.length,0);
  }
  assert.equal((await db.query('SELECT id_erabiltzailea FROM taldeak WHERE id_taldea=7')).rows[0].id_erabiltzailea,1);
  assert.equal((await db.query('SELECT * FROM saio_xehetasuna')).rows.length,5);
 }finally{await db.close();}
});
