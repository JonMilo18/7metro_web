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
    CREATE TABLE erabiltzaileak(id_erabiltzailea integer PRIMARY KEY);
    CREATE TABLE taldeak(id_taldea integer PRIMARY KEY);
    CREATE TABLE team_memberships(team_id integer,user_id integer,PRIMARY KEY(team_id,user_id));
    CREATE TABLE ariketak(id_ariketa integer PRIMARY KEY,id_erabiltzailea integer);
    CREATE TABLE mikrozikloak(id_mikroziklo integer PRIMARY KEY,id_taldea integer);
    CREATE TABLE saioak(id_saio serial PRIMARY KEY,id_taldea integer,id_erabiltzailea integer,id_mikroziklo integer,
      data_ordua text,lekua text,rpe_aurreikusia integer,helburu_taktikoa text,id_plangintza integer);
    CREATE TABLE saio_xehetasuna(id_xehetasuna serial PRIMARY KEY,id_saio integer REFERENCES saioak,id_ariketa integer REFERENCES ariketak,
      ordena integer,iraupena_minutuak integer,taldea text,aldaerak text,paraleloa integer);
    CREATE TABLE jokalariak(id_jokalaria integer PRIMARY KEY,id_taldea integer);
    CREATE TABLE partidak(id_partida serial PRIMARY KEY,id_taldea integer,id_erabiltzailea integer,data_ordua text,
      aurkaria text,lekua text,emaitza_geurea integer,emaitza_aurkaria integer,xehetasun_maila integer,estatistika_aurreratuak text);
    CREATE TABLE partida_jokalariak(id_partida integer REFERENCES partidak,id_jokalaria integer REFERENCES jokalariak,golak integer,jaurtiketak integer);
    CREATE TABLE partidu_zigorrak(id_partida integer REFERENCES partidak,id_jokalaria integer REFERENCES jokalariak,mota text CHECK(mota IN ('horia','2min','gorria','urdina')),minutua integer);
    CREATE TABLE partidu_jaurtiketak(id_partida integer REFERENCES partidak,id_jokalaria integer REFERENCES jokalariak,
      minutua integer,mota text,taldea text,jatorri_x float8,jatorri_y float8,helburu_x float8,helburu_y float8);
    INSERT INTO erabiltzaileak VALUES(9),(10),(11); INSERT INTO taldeak VALUES(7),(8);
    INSERT INTO team_memberships VALUES(7,9),(7,10),(8,9);
    INSERT INTO ariketak VALUES(1,9),(2,10); INSERT INTO jokalariak VALUES(3,7),(4,8);
  `);
  for (const name of ['20261112_training_editing.sql','20261114160000_offline_operations.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  }
  return db;
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function commit(db, action, data, options={}) {
  const request=options.request || {action, team_id:options.team || 7, operation_id:uuid(options.id || 1), data:'unchanged'};
  return (await db.query('SELECT commit_offline_operation($1,$2,$3,$4::jsonb,$5::jsonb) AS result',
    [options.user || 9,options.team || 7,uuid(options.id || 1),JSON.stringify(request),JSON.stringify(data)])).rows[0].result;
}
function match() { return {match:{data_ordua:'2026-11-15T18:00',aurkaria:'Aurkaria',lekua:'Etxean',emaitza_geurea:1,emaitza_aurkaria:0,
  estatistika_aurreratuak:JSON.stringify({event_records:[{type:'gol',taldea:'aurkaria',aurkaria:{zenbakia:8}}]})},
  players:[{id_jokalaria:3,golak:1,jaurtiketak:2}],sanctions:[{id_jokalaria:3,mota:'2min'}],
  shots:[{id_jokalaria:3,minutua:5,mota:'gol',taldea:'geurea',jatorri_x:.2,jatorri_y:.3,helburu_x:.7,helburu_y:.8}],events_saved:true}; }

test('offline match commits every child atomically and a retry returns the original result', async()=>{
  const db=await fixture();try {
    const first=await commit(db,'pwa_create_match',match());
    assert.equal(first.event_records_saved,true);
    assert.deepEqual(await commit(db,'pwa_create_match',match()),first);
    for(const name of ['partidak','partida_jokalariak','partidu_zigorrak','partidu_jaurtiketak','offline_operations']) {
      assert.equal((await db.query(`SELECT count(*)::integer AS n FROM ${name}`)).rows[0].n,1);
    }
    const stored=(await db.query('SELECT * FROM partidak')).rows[0];assert.equal(stored.id_taldea,7);assert.equal(stored.id_erabiltzailea,9);
    assert.equal(JSON.parse(stored.estatistika_aurreratuak).event_records[0].aurkaria.zenbakia,8);
    await assert.rejects(commit(db,'pwa_create_match',match(),{request:{action:'pwa_create_match',changed:true}}),error=>error.code==='PT409' && /beste datu/.test(error.message));
    await assert.rejects(commit(db,'pwa_create_match',match(),{team:8}),/beste datu/);
  }finally{await db.close();}
});
test('a failed child leaves no parent or ledger and the same operation can safely retry',async()=>{
  const db=await fixture();try {
    const bad=match();bad.sanctions[0].mota='invalid';
    await assert.rejects(commit(db,'pwa_create_match',bad));
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM partidak')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM offline_operations')).rows[0].n,0);
    await commit(db,'pwa_create_match',match());
    await assert.rejects(commit(db,'pwa_create_match',match(),{user:11,id:2}),/Ez zara/);
    const other=match();other.players[0].id_jokalaria=4;
    await assert.rejects(commit(db,'pwa_create_match',other,{id:2}),/ez da taldekoa/);
  }finally{await db.close();}
});
test('training create/edit retries preserve notes, ordering, parallel work and conflict protection',async()=>{
  const db=await fixture();try {
    const data={session:{data_ordua:'2026-11-15T18:00',lekua:'Kiroldegia',rpe_aurreikusia:5,helburu_taktikoa:'Defentsa',id_mikroziklo:null},
      details:[{id_ariketa:null,iraupena_minutuak:0,taldea:'Beroketa',paraleloa:0},{id_ariketa:1,iraupena_minutuak:15,taldea:'Beroketa',aldaerak:'Oharrak',paraleloa:1}]};
    const created=await commit(db,'pwa_create_session',data);assert.deepEqual(await commit(db,'pwa_create_session',data),created);
    const session=(await db.query('SELECT * FROM saioak WHERE id_saio=$1',[created.id])).rows[0];
    const details=(await db.query('SELECT * FROM saio_xehetasuna ORDER BY ordena')).rows;
    assert.equal(details[1].aldaerak,'Oharrak');assert.equal(details[1].paraleloa,1);
    const edited={source_id:created.id,session:{...data.session,lekua:'Beste lekua'},details:data.details,expected:{session,details}};
    const result=await commit(db,'pwa_update_session',edited,{id:2});assert.equal(result.session.lekua,'Beste lekua');
    assert.deepEqual(await commit(db,'pwa_update_session',edited,{id:2}),result);
    await assert.rejects(commit(db,'pwa_update_session',edited,{id:3}),error=>error.code==='PT409' && /beste gailu/.test(error.message));
    const bad=structuredClone(data);bad.details[1].id_ariketa=2;
    await assert.rejects(commit(db,'pwa_create_session',bad,{id:4}),/liburutegian/);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM offline_operations'),/permission denied/);
    await assert.rejects(db.query('SELECT read_offline_operation(9,7,$1,\'{}\'::jsonb)',[uuid(1)]),/permission denied/);
  }finally{await db.close();}
});
test('API helper rejects invalid IDs and passes authenticated ownership to the RPC',async()=>{
  const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../offline-actions.ts'),'utf8')).replace('export async function','async function');
  const context={};vm.createContext(context);vm.runInContext(source+'\nthis.run=offlineOperation;',context);
  const calls=[],db={rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,id:1},error:null};}},respond=(status,body)=>({status,body});
  assert.equal((await context.run({operation_id:'invalid'},db,7,9,respond)).status,400);assert.equal(calls.length,0);
  const payload={action:'pwa_create_match',operation_id:uuid(1),team_id:999,user_id:999};
  await context.run(payload,db,7,9,respond,{match:{}});
  assert.equal(calls[0].name,'commit_offline_operation');assert.equal(calls[0].args.p_user_id,9);assert.equal(calls[0].args.p_team_id,7);
  const conflict={rpc:async()=>({error:{code:'PT409',message:'Gatazka'}})};
  assert.equal((await context.run(payload,conflict,7,9,respond)).status,409);
});
