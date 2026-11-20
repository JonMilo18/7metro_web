const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module'),{PGlite}=require('@electric-sql/pglite');
const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20261119200000_session_templates.sql'),'utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE erabiltzaileak(id_erabiltzailea int PRIMARY KEY);CREATE TABLE taldeak(id_taldea int PRIMARY KEY);
 CREATE TABLE team_memberships(team_id int,user_id int,PRIMARY KEY(team_id,user_id));
 CREATE TABLE ariketak(id_ariketa int PRIMARY KEY,id_erabiltzailea int,izena text,arbela_datuak text);
 CREATE TABLE mikrozikloak(id_mikroziklo int PRIMARY KEY,id_taldea int);
 CREATE TABLE saioak(id_saio serial PRIMARY KEY,id_taldea int,id_erabiltzailea int,id_mikroziklo int,data_ordua text,lekua text,helburu_taktikoa text);
 CREATE TABLE saio_xehetasuna(id_xehetasuna serial PRIMARY KEY,id_saio int REFERENCES saioak ON DELETE CASCADE,id_ariketa int REFERENCES ariketak,ordena int,iraupena_minutuak int,taldea text,aldaerak text,paraleloa int);
 CREATE TABLE exercise_shares(exercise_id int,shared_with int);CREATE TABLE exercise_saves(exercise_id int,saved_by int);
 INSERT INTO erabiltzaileak VALUES(1),(2),(3);INSERT INTO taldeak VALUES(7),(8);INSERT INTO team_memberships VALUES(7,1),(7,2),(8,3);
 INSERT INTO ariketak VALUES(10,1,'Owner exercise','{"frames":[1,2]}'),(11,2,'Team exercise','private board'),(12,3,'Private exercise','secret');
 INSERT INTO saioak(id_taldea,id_erabiltzailea,data_ordua) VALUES(7,2,'2026-11-19T18:00');
 INSERT INTO saio_xehetasuna(id_saio,id_ariketa) VALUES(1,11);INSERT INTO mikrozikloak VALUES(1,7),(2,8);
 CREATE TABLE offline_operations(user_id int,operation_id uuid,team_id int,request jsonb,result jsonb,PRIMARY KEY(user_id,operation_id));`);
 const offline=fs.readFileSync(path.join(__dirname,'../migrations/20261114160000_offline_operations.sql'),'utf8');
 await db.exec(offline.slice(offline.indexOf('CREATE FUNCTION public.read_offline_operation'),offline.indexOf('-- The API supplies')));
 await db.exec(migration());return db;
}
const details=[{id_ariketa:null,iraupena_minutuak:0,taldea:'Beroketa',aldaerak:null,paraleloa:0},{id_ariketa:10,iraupena_minutuak:12,taldea:'Beroketa',aldaerak:'Original notes',paraleloa:0},{id_ariketa:null,iraupena_minutuak:0,taldea:'Zati nagusia',aldaerak:null,paraleloa:0},{id_ariketa:11,iraupena_minutuak:20,taldea:'Zati nagusia',aldaerak:'Keep team notes',paraleloa:1},{id_ariketa:10,iraupena_minutuak:4,taldea:'Zati nagusia',aldaerak:'Repeated',paraleloa:0}];
const content={name:'Defentsa',session:{lekua:'Kiroldegia',helburu_taktikoa:'Helburua'},details,total_minutes:90};
async function action(db,mode,payload={},data=null,user=1,team=7){return(await db.query('SELECT session_template_action($1,$2,$3,$4,$5) result',[user,team,mode,JSON.stringify(payload),data==null?null:JSON.stringify(data)])).rows[0].result;}
test('templates retain ordered separators, repeated and team exercises independently of source; creation is atomic and retry safe',async()=>{
 const db=await fixture();try{
 const id=crypto.randomUUID(),payload={template_id:id};await action(db,'save',payload,content);await action(db,'save',payload,content);
 assert.equal((await action(db,'list')).templates.length,1);assert.equal((await action(db,'list')).templates[0].exercise_count,3);
 await db.exec('DELETE FROM saioak WHERE id_saio=1');
 const loaded=await action(db,'get',payload,null,2);assert.deepEqual(loaded.template.details,details);assert.equal(loaded.exercises.length,2);assert(loaded.exercises.some(e=>e.arbela_datuak==='private board'));assert.equal(loaded.template.session.data_ordua,undefined);
 await assert.rejects(db.exec('DELETE FROM ariketak WHERE id_ariketa=11'),e=>['23503','23001'].includes(e.code));
 const operation=crypto.randomUUID(),request={action:'pwa_create_session',template_id:id,operation_id:operation};
 const create={session:{data_ordua:'2026-11-21T19:00',lekua:'Beste tokia',helburu_taktikoa:'Edited',id_mikroziklo:1},details};
 const saved=await action(db,'create',request,create,2);assert.equal((await action(db,'create',request,create,2)).id,saved.id);
 const rows=(await db.query('SELECT id_ariketa,iraupena_minutuak,taldea,aldaerak,paraleloa FROM saio_xehetasuna WHERE id_saio=$1 ORDER BY ordena',[saved.id])).rows;assert.deepEqual(rows,details);
 assert.equal((await db.query('SELECT count(*)::int n FROM saioak')).rows[0].n,1);
 assert.equal((await action(db,'get',payload)).template.session.helburu_taktikoa,'Helburua');
 await assert.rejects(action(db,'create',{...request,changed:true},create,2),e=>e.code==='PT409');
 await action(db,'delete',payload,null,2);assert.equal((await action(db,'list')).templates.length,0);assert.equal((await db.query('SELECT count(*)::int n FROM saioak')).rows[0].n,1);
 }finally{await db.close();}
});
test('template permissions isolate teams, private exercises, RPC roles and failed inserts',async()=>{
 const db=await fixture();try{
 const id=crypto.randomUUID(),payload={template_id:id};await action(db,'save',payload,content);
 await assert.rejects(action(db,'list',{},null,3),e=>e.code==='42501');await assert.rejects(action(db,'get',payload,null,3,8),e=>e.code==='P0002');
 await assert.rejects(action(db,'save',{template_id:crypto.randomUUID()},{...content,details:[{...details[1],id_ariketa:12}]}),e=>e.code==='42501');
 await assert.rejects(action(db,'save',payload,{...content,name:'Changed'}),e=>e.code==='PT409');
 assert.equal((await db.query("SELECT has_function_privilege('anon','session_template_action(integer,integer,text,jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 const create={session:{data_ordua:'2026-11-21T19:00',lekua:'A',helburu_taktikoa:'B',id_mikroziklo:2},details};
 await assert.rejects(action(db,'create',{...payload,operation_id:crypto.randomUUID()},create),e=>e.code==='22023');
 await db.exec("CREATE FUNCTION fail_template_detail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id_ariketa=11 THEN RAISE EXCEPTION 'fixture failure'; END IF;RETURN NEW;END $$;CREATE TRIGGER fail_template_detail BEFORE INSERT ON saio_xehetasuna FOR EACH ROW EXECUTE FUNCTION fail_template_detail();");
 const op=crypto.randomUUID();await assert.rejects(action(db,'create',{...payload,operation_id:op},{...create,session:{...create.session,id_mikroziklo:null}}));
 assert.equal((await db.query('SELECT count(*)::int n FROM offline_operations WHERE operation_id=$1',[op])).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int n FROM saioak')).rows[0].n,1);
 }finally{await db.close();}
});
test('template gateway normalizes content, uses session identity and rejects forged data',async()=>{
 const context={};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../session-template-actions.ts'),'utf8')).replace(/export /g,'')+'\nthis.handle=handleSessionTemplateAction;',context);
 let call;const client={rpc:async(name,args)=>{call={name,args};return{data:{ok:true}}}},respond=(status,body)=>({status,body});
 const payload={action:'session_template_save',team_id:7,user_id:99,template_id:crypto.randomUUID(),name:'Test',total_minutes:90,session:content.session,exercises:details.map(d=>({...d,is_separator:d.id_ariketa===null}))};
 assert.equal((await context.handle(payload,client,1,respond)).status,201);assert.equal(call.args.p_user_id,1);assert.equal(call.args.p_action,'save');assert.equal(call.args.p_data.details.length,5);
 assert.equal((await context.handle({...payload,template_id:'bad'},client,1,respond)).status,400);assert.equal((await context.handle({...payload,exercises:[{id_ariketa:10,iraupena_minutuak:-1}]},client,1,respond)).status,400);
 assert.equal((await context.handle({...payload,action:'pwa_create_session',operation_id:crypto.randomUUID(),data_ordua:'bad'},client,1,respond)).status,400);
});
test('account deletion retains template-only exercises in transferred teams and removes solo team templates',async()=>{
 const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const source=fs.readFileSync(path.join(__dirname,'account-deletion.test.cjs'),'utf8');
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const helpers=new Function('PGlite','pgcrypto','fs','path','__dirname','hash',source.slice(source.indexOf('async function fixture()'),source.indexOf("test('account deletion"))+'\nreturn {fixture,call};')(PGlite,pgcrypto,fs,path,__dirname,hash);
 const db=await helpers.fixture();try{
 await db.exec('CREATE TABLE exercise_shares(exercise_id integer,shared_with integer);');
 await db.exec(migration());
 const shared=crypto.randomUUID(),solo=crypto.randomUUID();
 await action(db,'save',{template_id:shared},{...content,details:[{...details[1],id_ariketa:2}]});
 await action(db,'save',{template_id:solo},{...content,details:[{...details[1],id_ariketa:4}]},1,8);
 const preview=(await helpers.call(db,'account_delete_preview')).preview;
 await helpers.call(db,'account_delete',{confirmation:'user1',current_password:'fixture-password',preview});
 assert.equal((await db.query('SELECT id_erabiltzailea FROM ariketak WHERE id_ariketa=2')).rows[0].id_erabiltzailea,null);
 assert.equal((await action(db,'get',{template_id:shared},null,2)).template.created_by,null);
 assert.equal((await db.query('SELECT count(*)::int n FROM session_templates WHERE id=$1',[solo])).rows[0].n,0);
 }finally{await db.close();}
});
