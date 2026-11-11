const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE team_memberships(team_id integer, user_id integer, PRIMARY KEY(team_id,user_id));
    CREATE TABLE ariketak(id_ariketa integer PRIMARY KEY, id_erabiltzailea integer, izena text);
    CREATE TABLE mikrozikloak(id_mikroziklo integer PRIMARY KEY, id_taldea integer);
    CREATE TABLE saioak(id_saio serial PRIMARY KEY, id_taldea integer, id_erabiltzailea integer,
      id_mikroziklo integer REFERENCES mikrozikloak, data_ordua text, lekua text,
      rpe_aurreikusia integer, helburu_taktikoa text, id_plangintza integer);
    CREATE TABLE saio_xehetasuna(id_xehetasuna serial PRIMARY KEY, id_saio integer REFERENCES saioak,
      id_ariketa integer REFERENCES ariketak, ordena integer, iraupena_minutuak integer,
      taldea text, aldaerak text, paraleloa integer DEFAULT 0);
    CREATE TABLE saio_bertaratzea(id_saio integer REFERENCES saioak, id_jokalaria integer, bertaratu integer);
    CREATE TABLE saio_plangintzak(id_saio integer REFERENCES saioak, id_plangintza integer);
    INSERT INTO team_memberships VALUES (7,9),(7,10),(8,10);
    INSERT INTO ariketak VALUES (1,9,'Ariketa'),(2,10,'Beste entrenatzailearen ariketa'),(3,11,'Pribatua');
    INSERT INTO mikrozikloak VALUES (21,7),(22,8);
    INSERT INTO saioak VALUES (1,7,9,21,'2026-11-10T18:00','Kiroldegia',8,'Defentsa',45),
      (2,8,10,22,'2026-11-10T19:00','Beste taldea',5,'Erasoa',NULL);
    SELECT setval('saioak_id_saio_seq',100);
    INSERT INTO saio_xehetasuna(id_saio,id_ariketa,ordena,iraupena_minutuak,taldea,aldaerak,paraleloa)
      VALUES (1,NULL,1,0,'Beroketa',NULL,0),(1,1,2,20,'Beroketa','Jatorrizko oharrak',0),
      (1,NULL,3,0,'Zati nagusia',NULL,0),(1,2,4,0,'Zati nagusia','<Gola> "ñ"',1),
      (1,1,5,12,'Zati nagusia','Ariketa errepikatua',0);
    INSERT INTO saio_bertaratzea VALUES(1,3,1);
    INSERT INTO saio_plangintzak VALUES(1,45);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261112_training_editing.sql'), 'utf8'));
  return db;
}

async function snapshot(db, id = 1) {
  const session = (await db.query('SELECT * FROM saioak WHERE id_saio=$1', [id])).rows[0];
  const details = (await db.query('SELECT * FROM saio_xehetasuna WHERE id_saio=$1 ORDER BY ordena ASC NULLS LAST,id_xehetasuna', [id])).rows;
  return { session, details };
}
const fields = { data_ordua: '2026-11-12T18:30', lekua: 'Frontoia', helburu_taktikoa: 'Gola', id_mikroziklo: 21 };
const content = details => details.map(({id_ariketa, iraupena_minutuak, taldea, aldaerak, paraleloa}) => ({id_ariketa, iraupena_minutuak, taldea, aldaerak, paraleloa}));
async function save(db, before, details, duplicate = false, options = {}) {
  const values = [options.team || 7, options.user || 9, options.id || 1, duplicate,
    JSON.stringify(options.fields || fields), JSON.stringify(details), JSON.stringify(before)];
  return (await db.query('SELECT save_team_session($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) AS result', values)).rows[0].result;
}

test('edit and duplicate preserve training content and keep attendance attached to the original', async () => {
  const db = await fixture();
  try {
    const original = await snapshot(db), details = content(original.details);
    const copied = await save(db, original, details, true);
    assert.notEqual(copied.id, 1);
    assert.deepEqual(await snapshot(db), original);
    assert.deepEqual(content(copied.details), details);
    assert.equal(copied.session.rpe_aurreikusia, 8);
    assert.equal(copied.session.id_plangintza, null);
    assert.equal((await db.query('SELECT * FROM saio_bertaratzea WHERE id_saio=$1',[copied.id])).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM saio_plangintzak WHERE id_saio=$1',[copied.id])).rows.length, 0);
    const changed = details.slice().reverse(); changed[0] = {...changed[0], aldaerak:'Aldatuta',iraupena_minutuak:7};
    const edited = await save(db, original, changed, false, {user:10});
    assert.equal(edited.id, 1);assert.equal(edited.session.id_erabiltzailea,9);
    assert.equal(edited.session.rpe_aurreikusia,8);assert.equal(edited.session.id_plangintza,45);
    assert.deepEqual(content(edited.details), changed);
    assert.equal((await db.query('SELECT * FROM saio_bertaratzea WHERE id_saio=1')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM saio_plangintzak WHERE id_saio=1')).rows.length, 1);
    await assert.rejects(save(db,original,details),{code:'40001'});
    await assert.rejects(save(db,original,details,true),{code:'40001'});
    const current = await snapshot(db);
    await assert.rejects(save(db,current,[...details,{...details[1],id_ariketa:3}]),{code:'22023'});
    await assert.rejects(save(db,current,details,false,{user:11}),{code:'42501'});
    await assert.rejects(save(db,current,details,false,{id:2}),{code:'P0002'});
    await assert.rejects(save(db,current,details,false,{fields:{...fields,id_mikroziklo:22}}),{code:'22023'});
    assert.deepEqual(await snapshot(db), current);
    const permissions=(await db.query("SELECT has_function_privilege('anon','save_team_session(integer,integer,integer,boolean,jsonb,jsonb,jsonb)','EXECUTE') AS anon,has_function_privilege('service_role','save_team_session(integer,integer,integer,boolean,jsonb,jsonb,jsonb)','EXECUTE') AS service")).rows[0];
    assert.deepEqual(permissions,{anon:false,service:true});
  } finally { await db.close(); }
});

test('a failed details insert rolls back the entire edit or copy', async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE FUNCTION fail_test_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.aldaerak = 'FAIL' THEN RAISE EXCEPTION 'Simulated storage failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_test BEFORE INSERT ON saio_xehetasuna FOR EACH ROW EXECUTE FUNCTION fail_test_insert();`);
    const before = await snapshot(db), details=content(before.details); details[1].aldaerak='FAIL';
    for(const duplicate of [false,true]){
      await assert.rejects(save(db,before,details,duplicate), /Simulated storage failure/);
      assert.deepEqual(await snapshot(db),before);
      assert.equal((await db.query('SELECT * FROM saioak')).rows.length,2);
    }
  } finally { await db.close(); }
});

test('the API validates writes and passes authenticated team context to the transaction', async () => {
  let source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../session-actions.ts'),'utf8')).replace('export async function','async function');
  const context={};vm.createContext(context);vm.runInContext(source+'\nthis.handle=handleSessionAction;',context);
  const snapshot={session:{id_saio:1},details:[]}, calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return{data:{id:1,session:snapshot.session,details:args.p_details},error:null};}};
  const respond=(status,body)=>({status,body});
  const payload={action:'pwa_update_session',id:1,...fields,exercises:[{id_ariketa:2,iraupena_minutuak:0,taldea:'Gola',aldaerak:'<Gola>',paraleloa:1}],snapshot};
  let result=await context.handle(payload,db,7,9,respond);assert.equal(result.status,200);
  assert.equal(calls[0].args.p_team_id,7);assert.equal(calls[0].args.p_user_id,9);assert.equal(calls[0].args.p_details[0].iraupena_minutuak,0);assert.equal(calls[0].args.p_details[0].paraleloa,1);
  for(const change of [{id:-1},{data_ordua:'invalid'},{id_mikroziklo:-1},{snapshot:null},{exercises:[{id_ariketa:1,iraupena_minutuak:-1}]},{exercises:[{id_ariketa:1,iraupena_minutuak:3,aldaerak:'x'.repeat(3001)}]}]){
    result=await context.handle({...payload,...change},db,7,9,respond);assert.equal(result.status,400);
  }
  assert.equal(calls.length,1);
  result=await context.handle({...payload,action:'pwa_duplicate_session',source_id:1},db,7,9,respond);
  assert.equal(result.status,201);assert.equal(calls[1].args.p_duplicate,true);
  db.rpc=async()=>({error:{code:'40001',message:'Conflict'}});
  result=await context.handle(payload,db,7,9,respond);assert.equal(result.status,409);
});
