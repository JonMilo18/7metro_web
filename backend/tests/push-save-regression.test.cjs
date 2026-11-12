const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

test('training saves wake the real scheduler once per transaction and survive network failures with queued retries',async()=>{
 const db=new PGlite();
 try{
  const fixture=fs.readFileSync(path.join(__dirname,'portal-actions.test.cjs'),'utf8').match(/await db\.exec\(`([\s\S]*?)`\);/)[1];
  await db.exec(fixture);
  await db.exec(`CREATE TABLE api_sessions(token_hash text PRIMARY KEY,user_id integer,expires_at bigint);
   CREATE TABLE friend_requests(id bigint PRIMARY KEY,requester_id integer,recipient_id integer,status text);
   CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
   INSERT INTO vault.decrypted_secrets VALUES('7metro_push_worker_token','fixture-only');
   CREATE SCHEMA extensions;
   CREATE FUNCTION extensions.hmac(text,text,text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode('abcd','hex') $$;
   CREATE SCHEMA net; CREATE TABLE net.requests(body jsonb,headers jsonb);
   CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
   BEGIN INSERT INTO net.requests VALUES(body,headers); RETURN 1; END $$;`);
  for(const name of ['20261112120000_player_portal.sql','20261112130000_preserve_callup_responses.sql','20261112140000_web_push.sql','20261112150000_fix_push_wake_training_save.sql'])
   await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  // Check the operational install script too, so a reinstall cannot restore the bug.
  const scheduler=fs.readFileSync(path.join(__dirname,'../push-scheduler.sql'),'utf8');
  await db.exec(scheduler.slice(scheduler.indexOf('CREATE OR REPLACE FUNCTION'),scheduler.indexOf('DO $$ BEGIN')));
  await db.exec(`INSERT INTO api_sessions VALUES(repeat('b',64),2,extract(epoch FROM now())::bigint+3600);
   INSERT INTO portal_player_links(player_id,team_id,user_id) VALUES(10,7,2);
   INSERT INTO push_subscriptions(user_id,device_hash,session_hash,endpoint,p256dh,auth)
   VALUES(2,repeat('2',64),repeat('b',64),'https://fcm.googleapis.com/fixture','fixture','fixture');`);
  await db.exec(`BEGIN;
   INSERT INTO saioak VALUES(102,7,to_char(current_date+3,'YYYY-MM-DD')||'T18:00','Kiroldegia','Training');
   INSERT INTO saioak VALUES(103,7,to_char(current_date+4,'YYYY-MM-DD')||'T18:00','Kiroldegia','Training');
   COMMIT;`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM net.requests')).rows[0].n,1,'Valid custom setting must allow exactly one wake per transaction');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM push_deliveries')).rows[0].n,2);
  await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'simulated network outage'; END $$;
   INSERT INTO saioak VALUES(104,7,to_char(current_date+5,'YYYY-MM-DD')||'T18:00','Kiroldegia','Training');`);
  await db.exec("UPDATE saioak SET lekua='Bestea' WHERE id_saio=104");
  assert.equal((await db.query('SELECT lekua FROM saioak WHERE id_saio=104')).rows[0].lekua,'Bestea','Both create and edit commit despite a failed wake');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM push_deliveries WHERE state='queued'")).rows[0].n,4,'Failed wake must retain deliveries for cron');
  await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
   BEGIN INSERT INTO net.requests VALUES(body,headers); RETURN 1; END $$;
   SELECT public.push_wake_worker();`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM net.requests')).rows[0].n,2,'The cron wake retries queued jobs after recovery');
 }finally{await db.close();}
});
