const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const model = require('../../insights-data.js');

const context = { SevenMetroInsights: model, Date };
vm.createContext(context);
const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../player-statistics-actions.ts'), 'utf8'));
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nthis.handle=handlePlayerStatisticsAction;', context);
const respond = (status, body) => ({ status, body });

async function fixture() {
  const db = new PGlite();
  const portal = fs.readFileSync(path.join(__dirname, 'portal-actions.test.cjs'), 'utf8');
  await db.exec(portal.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(`ALTER TABLE partidak ADD COLUMN estatistika_aurreratuak text;
    CREATE TABLE partida_jokalariak(id_partida integer,id_jokalaria integer,golak integer,jaurtiketak integer);
    CREATE TABLE partidu_zigorrak(id_partida integer,id_jokalaria integer,mota text);
    CREATE TABLE partidu_jaurtiketak(id_partida integer,id_jokalaria integer,mota text,taldea text,minutua integer,jatorri_x float,jatorri_y float,helburu_x float,helburu_y float);
    CREATE TABLE saio_bertaratzea(id_saio integer,id_jokalaria integer,bertaratu integer,atzerapena_min integer);
    UPDATE partidak SET data_ordua=to_char(current_date-1,'YYYY-MM-DD')||'T18:00';
    UPDATE saioak SET data_ordua=to_char(current_date-2,'YYYY-MM-DD')||'T18:00';
    INSERT INTO saioak VALUES(102,7,to_char(current_date-3,'YYYY-MM-DD')||'T18:00','Kiroldegia','PRIVATE TRAINING NOTE');
    INSERT INTO saio_bertaratzea VALUES(100,10,1,5),(100,11,0,0);
    INSERT INTO partida_jokalariak VALUES(200,10,3,5),(200,11,99,100),(201,12,80,90);
    INSERT INTO partidu_zigorrak VALUES(200,10,'horia'),(200,11,'gorria');`);
  for (const name of ['20261112120000_player_portal.sql', '20261113140000_player_statistics.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
  }
  await db.exec('INSERT INTO portal_player_links(player_id,team_id,user_id) VALUES(10,7,2),(12,8,3)');
  await db.query('UPDATE partidak SET estatistika_aurreratuak=$1 WHERE id_partida=200', [JSON.stringify({ private: 'PRIVATE MATCH NOTE', event_records: [
    { type: 'penalti_gol', taldea: 'geurea', player_id: 10 },
    { type: 'gol', taldea: 'geurea', player_id: 11, player_label: 'PRIVATE TEAMMATE' },
    { type: 'gol', taldea: 'aurkaria', aurkaria: { izena: 'PRIVATE OPPONENT' } },
  ] })]);
  return db;
}
async function rpc(db, user, action, data = {}) {
  return (await db.query('SELECT player_statistics_action($1,$2,$3::jsonb) AS result', [user, action, JSON.stringify(data)])).rows[0].result;
}
function client(db) {
  return { rpc: async (name, args) => {
    try { return { data: await rpc(db, args.p_user, args.p_action, args.p_data) }; }
    catch (error) { return { error: { code: error.code, message: error.message } }; }
  } };
}

test('personal statistics default to disabled and only team staff can change access', async () => {
  const db = await fixture();
  try {
    assert.equal((await rpc(db, 2, 'status', { player_id: 10 })).enabled, false);
    await assert.rejects(rpc(db, 2, 'get', { player_id: 10 }), error => error.code === '42501');
    await assert.rejects(rpc(db, 2, 'save_settings', { team_id: 7, enabled: true, version: 0 }), error => error.code === '42501');
    await assert.rejects(rpc(db, 4, 'settings', { team_id: 7 }), error => error.code === '42501');
    const enabled = await rpc(db, 1, 'save_settings', { team_id: 7, enabled: true, version: 0 });
    assert.equal(enabled.enabled, true);
    await assert.rejects(rpc(db, 1, 'save_settings', { team_id: 7, enabled: false, version: 0 }), error => error.code === '40001');
    assert.equal((await rpc(db, 2, 'status', { player_id: 10 })).enabled, true);
    assert.equal((await rpc(db, 3, 'status', { player_id: 12 })).enabled, false);
    await assert.rejects(rpc(db, 2, 'get', { player_id: 12 }), error => error.code === '42501');
    await rpc(db, 1, 'save_settings', { team_id: 7, enabled: false, version: enabled.version });
    await assert.rejects(rpc(db, 2, 'get', { player_id: 10 }), error => error.code === '42501');
    const rights = (await db.query("SELECT has_function_privilege('anon','player_statistics_action(integer,text,jsonb)','execute') AS rpc,has_table_privilege('authenticated','portal_stats_settings','select') AS read")).rows[0];
    assert.deepEqual(rights, { rpc: false, read: false });
  } finally { await db.close(); }
});

test('the player API reuses coach calculations and exposes only personal summaries', async () => {
  const db = await fixture();
  try {
    await rpc(db, 1, 'save_settings', { team_id: 7, enabled: true, version: 0 });
    const response = await context.handle({ action: 'player_stats_get', player_id: 10, user_id: 1, period: 'all' }, client(db), 2, respond);
    assert.equal(response.status, 200);
    const data = JSON.parse(JSON.stringify(response.body));
    assert.equal(data.summary.matches, 1);
    assert.equal(data.summary.goals, 3);
    assert.equal(data.summary.shots, 5);
    assert.equal(data.summary.efficiency, 60);
    assert.equal(data.summary.penaltyGoals, 1);
    assert.equal(data.summary.sanctions.horia, 1);
    assert.equal(data.attendance.recorded, 1);
    assert.equal(data.attendance.present, 1);
    assert.equal(data.attendance.absent, 0, 'Missing attendance records are not absences');
    assert.equal(data.attendance.rate, 100);
    assert.equal(data.attendance.entries.length, 2);
    assert(!JSON.stringify(data).includes('PRIVATE'));
    assert(!('tables' in data));
    assert(!JSON.stringify(data).includes('estatistika_aurreratuak'));
    assert.deepEqual(data.matches.map(match => match.id), [200]);
    const unauthorized = await context.handle({ action: 'player_stats_get', player_id: 10 }, client(db), 3, respond);
    assert.equal(unauthorized.status, 403);
  } finally { await db.close(); }
});

test('legacy event-only stats, periods, malformed JSON and revoked links are handled', async () => {
  const db = await fixture();
  try {
    await rpc(db, 1, 'save_settings', { team_id: 7, enabled: true, version: 0 });
    await db.exec("DELETE FROM partida_jokalariak; DELETE FROM partidu_zigorrak; INSERT INTO partidak(id_partida,id_taldea,data_ordua,aurkaria,estatistika_aurreratuak) VALUES(202,7,to_char(current_date-80,'YYYY-MM-DD')||'T18:00','Old match','broken JSON');");
    const first = await context.handle({ action: 'player_stats_get', player_id: 10 }, client(db), 2, respond);
    assert.equal(first.body.summary.goals, 1);
    assert.equal(first.body.summary.shots, 1);
    assert.equal(first.body.summary.matches, 1);
    await db.exec('INSERT INTO partida_jokalariak VALUES(202,10,4,8)');
    assert.equal((await context.handle({ action: 'player_stats_get', player_id: 10, period: 'all' }, client(db), 2, respond)).body.summary.goals, 5);
    assert.equal((await context.handle({ action: 'player_stats_get', player_id: 10, period: 'month' }, client(db), 2, respond)).body.summary.goals, 1);
    await db.exec('DELETE FROM portal_player_links WHERE player_id=10');
    assert.equal((await context.handle({ action: 'player_stats_get', player_id: 10 }, client(db), 2, respond)).status, 403);
    assert.equal((await context.handle({ action: 'player_stats_save_settings', team_id: 7, enabled: 'true', version: 1 }, client(db), 1, respond)).status, 400);
  } finally { await db.close(); }
});
