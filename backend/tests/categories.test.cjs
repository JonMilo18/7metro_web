const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
test('canonical migration preserves all legacy categories; writes are atomic and removal is owner scoped',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE team_memberships(team_id integer,user_id integer);
 CREATE TABLE kategoriak(id_kategoria serial PRIMARY KEY,izena text NOT NULL);
 CREATE TABLE ariketak(id_ariketa serial PRIMARY KEY,izena text,deskribapena text,jokalari_kopurua integer,
 arbela_datuak text,bideo_url text,id_erabiltzailea integer,id_kategoria integer,kategoria text);
 CREATE TABLE kategoriak_has_ariketak(kategoriak_id_kategoria integer REFERENCES kategoriak ON DELETE CASCADE,
 ariketak_id_ariketa integer REFERENCES ariketak ON DELETE CASCADE,PRIMARY KEY(kategoriak_id_kategoria,ariketak_id_ariketa));
 INSERT INTO kategoriak(izena) VALUES('Taktika'),('  TÁKTIKA '),('Teknika');
 INSERT INTO ariketak(izena,id_erabiltzailea,id_kategoria,kategoria,arbela_datuak) VALUES('Private A',9,2,'Teknika','board'),('Private B',10,2,NULL,'private'),('Legacy',9,NULL,'Berria',NULL);
 INSERT INTO kategoriak_has_ariketak VALUES(1,1),(2,1),(2,2);
 INSERT INTO team_memberships VALUES(7,9),(7,10);`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261119120000_canonical_categories.sql'),'utf8'));
 assert.equal((await db.query('SELECT count(*)::int n FROM kategoriak')).rows[0].n,3);
 assert.deepEqual((await db.query('SELECT * FROM kategoriak_has_ariketak ORDER BY ariketak_id_ariketa,kategoriak_id_kategoria')).rows.map(r=>Object.values(r)),[[1,1],[3,1],[1,2],[4,3]]);
 const resolve=async(name)=>(await db.query('SELECT resolve_category_names($1,true) result',[[name]])).rows[0].result[0];
 assert.equal((await resolve(' tÁktika ')).id_kategoria,1);
 await assert.rejects(db.exec("INSERT INTO kategoriak(izena) VALUES('TAKTIKA')"),e=>e.code==='23505');
 await assert.rejects(db.query("SELECT create_categorized_exercise(99,7,'{\"izena\":\"bad\"}',ARRAY['Taktika'])"),e=>e.code==='42501');
 await assert.rejects(db.query("SELECT create_categorized_exercise(9,7,'{\"izena\":\"bad\"}',ARRAY['Missing'])"));
 assert.equal((await db.query('SELECT count(*)::int n FROM ariketak')).rows[0].n,3);
 await db.query("SELECT create_categorized_exercise(9,7,'{\"izena\":\"new\"}',ARRAY['Taktika','Teknika'])");
 await db.exec("INSERT INTO ariketak(izena,id_erabiltzailea,id_kategoria) VALUES('Old remote ID',9,2)");
 assert.equal((await db.query("SELECT id_kategoria FROM ariketak WHERE izena='Old remote ID'")).rows[0].id_kategoria,1);
 await db.query("SELECT detach_user_category(9,7,'TÁKTIKA')");
 assert.equal((await db.query('SELECT count(*)::int n FROM kategoriak_has_ariketak l JOIN ariketak a ON a.id_ariketa=l.ariketak_id_ariketa WHERE a.id_erabiltzailea=9 AND l.kategoriak_id_kategoria=1')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=2')).rows[0].n,1);
 assert.equal((await db.query('SELECT arbela_datuak FROM ariketak WHERE id_ariketa=2')).rows[0].arbela_datuak,'private');
 assert.equal((await db.query("SELECT has_function_privilege('anon','resolve_category_names(text[],boolean)','EXECUTE') allowed")).rows[0].allowed,false);
 await db.exec("CREATE FUNCTION fail_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kategoriak_id_kategoria=3 THEN RAISE EXCEPTION 'fail'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_link BEFORE INSERT ON kategoriak_has_ariketak FOR EACH ROW EXECUTE FUNCTION fail_link();");
 await assert.rejects(db.query("SELECT create_categorized_exercise(9,7,'{\"izena\":\"rollback\"}',ARRAY['Taktika','Teknika'])"));
 assert.equal((await db.query("SELECT count(*)::int n FROM ariketak WHERE izena='rollback'")).rows[0].n,0);
 }finally{await db.close();}
});
test('desktop category IDs resolve by name, without modifying input or multiplying links',async()=>{
 const context={structuredClone};vm.createContext(context);
 vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../category-actions.ts'),'utf8')).replace(/export /g,'')+'\nthis.reconcile=reconcileCategorySync;',context);
 const client={rpc:async(name,args)=>({data:args.p_names.map(izena=>({izena,id_kategoria:izena==='Taktika'?42:43}))})};
 const input={kategoriak:[{id_kategoria:1,izena:'Taktika'},{id_kategoria:2,izena:'Teknika'}],ariketak:[{id_kategoria:1,kategoria:'2'}],kategoriak_has_ariketak:[{ariketak_id_ariketa:99,kategoriak_id_kategoria:1},{ariketak_id_ariketa:99,kategoriak_id_kategoria:1}]};
 const result=await context.reconcile(client,input);
 assert.equal(result.ariketak[0].id_kategoria,43);assert.equal(result.kategoriak_has_ariketak[0].kategoriak_id_kategoria,42);assert.equal(result.kategoriak_has_ariketak.length,1);assert.equal(input.ariketak[0].id_kategoria,1);assert.equal(result.kategoriak,undefined);
 await assert.rejects(context.reconcile(client,{kategoriak:input.kategoriak,ariketak:[{id_kategoria:900}]}));
});
