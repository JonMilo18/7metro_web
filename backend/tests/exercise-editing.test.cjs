const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite'),{stripTypeScriptTypes}=require('node:module');
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE erabiltzaileak(id_erabiltzailea int PRIMARY KEY);INSERT INTO erabiltzaileak VALUES(1),(2);
 CREATE TABLE team_memberships(team_id int,user_id int);INSERT INTO team_memberships VALUES(7,1),(7,2),(8,2);
 CREATE TABLE kategoriak(id_kategoria serial PRIMARY KEY,izena text NOT NULL);INSERT INTO kategoriak(izena) VALUES('Taktika'),('Teknika'),('Other private category');
 CREATE TABLE ariketak(id_ariketa serial PRIMARY KEY,izena text,deskribapena text,jokalari_kopurua int,kategoria text,id_kategoria int,id_erabiltzailea int,arbela_datuak text,bideo_url text,espezifizitatea int,sortze_data text);
 INSERT INTO ariketak(izena,deskribapena,jokalari_kopurua,id_kategoria,id_erabiltzailea,arbela_datuak,espezifizitatea,sortze_data) VALUES('Original','Original notes',8,1,1,'{ "fondo":"Zelaia", "animazioa":[{"x":1},{"x":2}], "marrazkiak":[{"curve":22}] }',77,'2026-01-01'),('Private B',NULL,9,3,2,'{}',8,'2026-01-02');
 CREATE TABLE kategoriak_has_ariketak(kategoriak_id_kategoria int REFERENCES kategoriak ON DELETE CASCADE,ariketak_id_ariketa int REFERENCES ariketak ON DELETE CASCADE,PRIMARY KEY(kategoriak_id_kategoria,ariketak_id_ariketa));INSERT INTO kategoriak_has_ariketak VALUES(1,1),(2,1),(3,2);
 CREATE TABLE training_reference(id int PRIMARY KEY,exercise_id int REFERENCES ariketak);INSERT INTO training_reference VALUES(4,1);
 CREATE TABLE template_reference(id int PRIMARY KEY,exercise_id int REFERENCES ariketak);INSERT INTO template_reference VALUES(5,1);`);
 for(const file of ['20261119120000_canonical_categories.sql','20261123120000_personal_categories.sql','20261124120000_edit_exercises.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));return db;
}
async function call(db,action,id=1,data=null,expected=null,user=1,team=7){return(await db.query('SELECT edit_owned_exercise($1,$2,$3,$4,$5,$6) result',[user,team,action,id,data==null?null:JSON.stringify(data),expected==null?null:JSON.stringify(expected)])).rows[0].result;}
const edited=row=>({izena:'Updated',deskribapena:'New notes',jokalari_kopurua:12,bideo_url:'https://example.org/drill',arbela_datuak:row.arbela_datuak,categories:['Teknika']});
test('editing preserves identity, exact animation bytes, other metadata and every training/template reference; category changes are atomic',async()=>{
 const db=await fixture();try{
 let original=await call(db,'get'),data=edited(original.exercise);assert.equal(original.categories.length,2);
 const saved=await call(db,'update',1,data,original.snapshot);assert.equal(saved.id,1);assert.equal(saved.exercise.id_erabiltzailea,1);assert.equal(saved.exercise.espezifizitatea,77);assert.equal(saved.exercise.sortze_data,'2026-01-01');assert.equal(saved.exercise.arbela_datuak,original.exercise.arbela_datuak);assert.equal(saved.exercise.izena,'Updated');
 assert.deepEqual((await db.query('SELECT * FROM training_reference')).rows,[{id:4,exercise_id:1}]);assert.deepEqual((await db.query('SELECT * FROM template_reference')).rows,[{id:5,exercise_id:1}]);assert.equal((await db.query('SELECT count(*)::int n FROM ariketak')).rows[0].n,2);assert.deepEqual((await call(db,'get')).snapshot.categories,[2]);
 original=await call(db,'get');await db.exec("CREATE FUNCTION fail_exercise_category() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kategoriak_id_kategoria=1 THEN RAISE EXCEPTION 'fixture failure';END IF;RETURN NEW;END $$;CREATE TRIGGER fail_exercise_category BEFORE INSERT ON kategoriak_has_ariketak FOR EACH ROW EXECUTE FUNCTION fail_exercise_category();");
 await assert.rejects(call(db,'update',1,{...data,izena:'Should roll back',categories:['Taktika']},original.snapshot));assert.deepEqual((await call(db,'get')).snapshot,original.snapshot);
 await call(db,'update',1,{...data,categories:[]},original.snapshot);const empty=await call(db,'get');assert.equal(empty.exercise.id_kategoria,null);assert.deepEqual(empty.snapshot.categories,[]);
 }finally{await db.close();}
});
test('editing denies another owner and category, checks team membership, and rejects stale snapshots',async()=>{
 const db=await fixture();try{
 const original=await call(db,'get'),data=edited(original.exercise);
 await assert.rejects(call(db,'get',2),e=>e.code==='P0002');await assert.rejects(call(db,'get',1,null,null,1,8),e=>e.code==='42501');await assert.rejects(call(db,'update',1,{...data,categories:['Other private category']},original.snapshot),e=>e.code==='42501');
 await db.exec("UPDATE ariketak SET izena='Changed on other device' WHERE id_ariketa=1");await assert.rejects(call(db,'update',1,data,original.snapshot),e=>e.code==='PT409');assert.equal((await call(db,'get')).exercise.izena,'Changed on other device');assert.deepEqual((await call(db,'get')).snapshot.categories,[1,2]);
 assert.equal((await db.query("SELECT has_function_privilege('anon','edit_owned_exercise(integer,integer,text,integer,jsonb,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
test('edit gateway validates content and board changes, preserves untouched legacy boards, and uses authenticated identity',async()=>{
 const context={};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../exercise-actions.ts'),'utf8')).replace(/export /g,'')+'this.handle=handleExerciseEdit;',context);
 let seen;const client={rpc:async(name,args)=>{seen={name,args};return{data:{ok:true,id:1}}}},respond=(status,body)=>({status,body});
 const payload={action:'pwa_update_exercise',id:1,team_id:7,user_id:88,izena:'Name',kategoriak:['Taktika'],jokalari_kopurua:8,arbela_datuak:'legacy',snapshot:{exercise:{arbela_datuak:'legacy'},categories:[1]}};
 assert.equal((await context.handle(payload,client,1,respond)).status,200);assert.equal(seen.args.p_user_id,1);assert.equal(seen.args.p_data.arbela_datuak,'legacy');
 assert.equal((await context.handle({...payload,arbela_datuak:'not JSON'},client,1,respond)).status,400);assert.equal((await context.handle({...payload,jokalari_kopurua:101},client,1,respond)).status,400);assert.equal((await context.handle({...payload,snapshot:null},client,1,respond)).status,400);assert.equal((await context.handle({...payload,action:'pwa_get_exercise'},client,1,respond)).status,200);
 assert.equal((await context.handle(payload,{rpc:async()=>({error:{code:'PT409',message:'Changed'}})},1,respond)).status,409);
});
