const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('personal catalogs isolate creators while reusing canonical IDs and preserving all exercise permissions and links',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE erabiltzaileak(id_erabiltzailea integer PRIMARY KEY);INSERT INTO erabiltzaileak VALUES(1),(2),(3);
 CREATE TABLE team_memberships(team_id integer,user_id integer);INSERT INTO team_memberships VALUES(7,1),(7,2),(8,3);
 CREATE TABLE kategoriak(id_kategoria serial PRIMARY KEY,izena text NOT NULL);
 CREATE TABLE ariketak(id_ariketa serial PRIMARY KEY,izena text,deskribapena text,jokalari_kopurua integer,arbela_datuak text,bideo_url text,id_erabiltzailea integer,id_kategoria integer,kategoria text);
 CREATE TABLE kategoriak_has_ariketak(kategoriak_id_kategoria integer REFERENCES kategoriak ON DELETE CASCADE,ariketak_id_ariketa integer REFERENCES ariketak ON DELETE CASCADE,PRIMARY KEY(kategoriak_id_kategoria,ariketak_id_ariketa));
 INSERT INTO kategoriak(izena) VALUES('Taktika'),('Teknika'),('Other unused category');
 INSERT INTO ariketak(izena,id_erabiltzailea,id_kategoria,arbela_datuak) VALUES('Private A',1,1,'board A'),('Private B',2,2,'board B');
 INSERT INTO kategoriak_has_ariketak VALUES(1,1),(2,2);`);
 for(const name of ['20261119120000_canonical_categories.sql','20261123120000_personal_categories.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 const catalog=async user=>(await db.query('SELECT user_category_catalog($1) result',[user])).rows[0].result;
 const resolve=async(user,names,register=true)=>(await db.query('SELECT resolve_user_category_names($1,$2,$3) result',[user,names,register])).rows[0].result;
 assert.deepEqual((await catalog(1)).map(c=>c.izena),['Taktika']);assert.deepEqual((await catalog(2)).map(c=>c.izena),['Teknika']);assert.deepEqual(await catalog(3),[]);
 await resolve(1,['TAKTIKA','Other unused category'],false);assert.equal((await catalog(1)).length,1);
 assert.equal((await resolve(1,['  TÉKNIKA  ']))[0].id_kategoria,2);assert.equal((await catalog(1)).length,2);assert.equal((await db.query('SELECT count(*)::int n FROM kategoriak')).rows[0].n,3);
 const added=(await resolve(1,['New personal']))[0];assert(!(await catalog(2)).some(c=>c.id_kategoria===added.id_kategoria));assert(!(await catalog(3)).some(c=>c.id_kategoria===added.id_kategoria));
 await assert.rejects(db.query("SELECT create_categorized_exercise(2,7,'{\"izena\":\"No access\"}',ARRAY['New personal'])"),e=>e.code==='42501');
 await db.query("SELECT create_categorized_exercise(1,7,'{\"izena\":\"New exercise\"}',ARRAY['Teknika'])");
 await db.query("SELECT detach_user_category(1,7,'Teknika')");assert(!(await catalog(1)).some(c=>c.id_kategoria===2));assert((await catalog(2)).some(c=>c.id_kategoria===2));
 assert.equal((await db.query('SELECT count(*)::int n FROM kategoriak_has_ariketak WHERE ariketak_id_ariketa=2 AND kategoriak_id_kategoria=2')).rows[0].n,1);
 assert.equal((await db.query('SELECT arbela_datuak FROM ariketak WHERE id_ariketa=2')).rows[0].arbela_datuak,'board B');
 await db.query("INSERT INTO ariketak(izena,id_erabiltzailea,kategoria) VALUES('Desktop',1,'Other unused category')");assert((await catalog(1)).some(c=>c.id_kategoria===3));
 assert.equal((await db.query("SELECT has_function_privilege('anon','user_category_catalog(integer)','EXECUTE') allowed")).rows[0].allowed,false);
 await db.exec('DELETE FROM erabiltzaileak WHERE id_erabiltzailea=1');assert.equal((await db.query('SELECT count(*)::int n FROM user_categories WHERE user_id=1')).rows[0].n,0);assert.equal((await catalog(2)).length,1);
 }finally{await db.close();}
});
