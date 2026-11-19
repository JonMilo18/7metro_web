const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
test('attendance import copies only confirmed current links, preserves actual attendance, and isolates teams and roles',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE team_memberships(team_id integer,user_id integer,PRIMARY KEY(team_id,user_id));
 CREATE TABLE saioak(id_saio integer PRIMARY KEY,id_taldea integer);
 CREATE TABLE jokalariak(id_jokalaria integer PRIMARY KEY,id_taldea integer);
 CREATE TABLE portal_player_links(player_id integer PRIMARY KEY,team_id integer,user_id integer);
 CREATE TABLE portal_event_responses(player_id integer,kind text,event_id integer,user_id integer,response text,PRIMARY KEY(player_id,kind,event_id));
 CREATE TABLE saio_bertaratzea(id_saio integer,id_jokalaria integer,bertaratu integer,atzerapena_min integer,atzerapena_mota text,UNIQUE(id_saio,id_jokalaria));
 INSERT INTO team_memberships VALUES(7,9),(7,10),(8,10);INSERT INTO saioak VALUES(1,7),(2,8);
 INSERT INTO jokalariak SELECT x,7 FROM generate_series(11,17)x;INSERT INTO jokalariak VALUES(20,8);
 INSERT INTO portal_player_links SELECT x,7,x+100 FROM generate_series(11,16)x;INSERT INTO portal_player_links VALUES(20,8,120);
 INSERT INTO portal_event_responses VALUES(11,'session',1,111,'yes'),(12,'session',1,112,'no'),(13,'session',1,113,'maybe'),(15,'session',1,115,'yes'),(16,'session',1,999,'yes'),(17,'session',1,117,'yes'),(20,'session',1,120,'yes'),(14,'match',1,114,'yes');
 INSERT INTO saio_bertaratzea VALUES(1,15,0,12,'Justifikatua');`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261119100000_callup_attendance.sql'),'utf8'));
 const call=async(team,user,id)=>(await db.query('SELECT apply_session_response_attendance($1,$2,$3) AS result',[team,user,id])).rows[0].result;
 const result=await call(7,9,1);assert.equal(result.copied,2);assert.equal(result.preserved,1);
 const rows=(await db.query('SELECT * FROM saio_bertaratzea ORDER BY id_jokalaria')).rows;
 assert.deepEqual(rows.map(r=>[r.id_jokalaria,r.bertaratu]),[[11,1],[12,0],[15,0]]);assert.equal(rows[2].atzerapena_min,12);
 await db.exec("UPDATE portal_event_responses SET response='no' WHERE player_id=11");assert.equal((await call(7,10,1)).copied,0);assert.equal((await db.query('SELECT bertaratu FROM saio_bertaratzea WHERE id_jokalaria=11')).rows[0].bertaratu,1);
 await assert.rejects(call(7,111,1),e=>e.code==='42501');await assert.rejects(call(8,9,2),e=>e.code==='42501');await assert.rejects(call(7,9,2),e=>e.code==='P0002');
 assert.equal((await db.query("SELECT has_function_privilege('anon','apply_session_response_attendance(integer,integer,integer)','EXECUTE') AS allowed")).rows[0].allowed,false);
 assert.equal((await db.query("SELECT has_function_privilege('service_role','apply_session_response_attendance(integer,integer,integer)','EXECUTE') AS allowed")).rows[0].allowed,true);
 await db.exec("DELETE FROM saio_bertaratzea WHERE id_jokalaria IN (11,12);CREATE FUNCTION fail_import() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id_jokalaria=12 THEN RAISE EXCEPTION 'fixture failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER fail_import BEFORE INSERT ON saio_bertaratzea FOR EACH ROW EXECUTE FUNCTION fail_import();");
 await assert.rejects(call(7,9,1));assert.equal((await db.query('SELECT count(*)::integer AS n FROM saio_bertaratzea WHERE id_jokalaria IN (11,12)')).rows[0].n,0);

 }finally{await db.close();}
});
test('attendance gateway validates IDs and uses authenticated identity with the atomic RPC',async()=>{
 const context={};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../portal-actions.ts'),'utf8')).replace(/export /g,'')+'\nthis.handle=handlePortalAction;',context);
 let call;const client={rpc:async(name,args)=>{call={name,args};return {data:{ok:true,copied:2}}}},respond=(status,body)=>({status,body});
 assert.equal((await context.handle({action:'portal_apply_attendance',team_id:7,session_id:1,user_id:88},client,9,respond)).status,200);assert.equal(call.name,'apply_session_response_attendance');assert.equal(call.args.p_user_id,9);
 assert.equal((await context.handle({action:'portal_apply_attendance',team_id:7,session_id:'1'},client,9,respond)).status,400);
 assert.equal((await context.handle({action:'portal_apply_attendance',team_id:7,session_id:1},{rpc:async()=>({error:{code:'P0002',message:'missing'}})},9,respond)).status,404);
});
