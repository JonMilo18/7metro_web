const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');

async function fixture() {
  const db = new PGlite();
  const source = fs.readFileSync(path.join(__dirname, 'portal-actions.test.cjs'), 'utf8');
  await db.exec(source.match(/await db\.exec\(`([\s\S]*?)`\);/)[1]);
  await db.exec(`CREATE SEQUENCE saioak_id_saio_seq START 300;
    ALTER TABLE saioak ALTER COLUMN id_saio SET DEFAULT nextval('saioak_id_saio_seq');
    ALTER TABLE saioak ADD COLUMN id_erabiltzailea integer;
    ALTER TABLE saioak ADD COLUMN rpe_aurreikusia integer;
    CREATE TABLE api_sessions(token_hash text PRIMARY KEY,user_id integer,expires_at bigint);
    CREATE TABLE friend_requests(id bigint PRIMARY KEY,requester_id integer,recipient_id integer,status text);`);
  for (const name of ['20261112120000_player_portal.sql', '20261112140000_web_push.sql', '20261113120000_weekly_training_schedule.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
  }
  return db;
}

const slots = [
  { weekday: 1, time: '18:00', lekua: 'Kiroldegia', helburu_taktikoa: 'Defentsa' },
  { weekday: 2, time: '19:00', lekua: 'Frontoia', helburu_taktikoa: '' },
  { weekday: 7, time: '10:30', lekua: 'Kiroldegia', helburu_taktikoa: 'Erasoa' },
];
async function call(db, action, data = {}, user = 1, team = 7) {
  return (await db.query('SELECT weekly_training_action($1,$2,$3,$4::jsonb) AS result',
    [user, team, action, JSON.stringify({ week_start: '2028-02-28', ...data })])).rows[0].result;
}

test('weekly publication handles leap days, existing trainings, retries, edits and deleted sessions', async () => {
  const db = await fixture();
  try {
    assert.equal((await call(db, 'get')).version, 0);
    const saved = await call(db, 'save', { slots, version: 0 });
    assert.equal(saved.version, 1);
    await db.exec("INSERT INTO saioak(id_saio,id_taldea,data_ordua,lekua,helburu_taktikoa) VALUES(250,7,'2028-02-28 18:00:00','Existing venue','Existing title')");
    const first = await call(db, 'publish', { version: 1 });
    assert.equal(first.created_ids.length, 2);
    assert.equal(first.skipped, 1);
    assert.equal(first.publications.length, 3);
    const dates = (await db.query("SELECT data_ordua FROM saioak WHERE id_saio=ANY($1) ORDER BY data_ordua", [first.created_ids])).rows.map(row => row.data_ordua);
    assert.deepEqual(dates, ['2028-02-29T19:00', '2028-03-05T10:30']);
    assert.equal((await db.query('SELECT lekua FROM saioak WHERE id_saio=250')).rows[0].lekua, 'Existing venue');
    await db.query("UPDATE saioak SET data_ordua='2028-03-01T17:00' WHERE id_saio=$1", [first.created_ids[0]]);
    assert.equal((await call(db, 'publish', { version: 1 })).created_ids.length, 0, 'Retries must also recognize a published training whose date was edited');
    await db.query('DELETE FROM saioak WHERE id_saio=$1', [first.created_ids[1]]);
    assert.equal((await call(db, 'publish', { version: 1 })).created_ids.length, 1, 'Deleted trainings can be published again');
    assert.equal((await call(db, 'publish', { version: 1, week_start: '2028-03-06' })).created_ids.length, 3);
    await call(db, 'save', { slots: [], version: 1 });
    await assert.rejects(call(db, 'publish', { version: 2 }), error => error.code === '22023');
  } finally { await db.close(); }
});

test('schedule validation, stale saves, team isolation and atomic rollback protect weekly publication', async () => {
  const db = await fixture();
  try {
    await assert.rejects(call(db, 'get', {}, 2), error => error.code === '42501');
    await assert.rejects(call(db, 'get', {}, 1, 8), error => error.code === '42501');
    await call(db, 'save', { slots, version: 0 });
    await assert.rejects(call(db, 'save', { slots: [], version: 0 }), error => error.code === '40001');
    for (const bad of [[slots[0], slots[0]], [{ ...slots[0], time: '25:00' }], [{ ...slots[0], weekday: 0 }], [{ ...slots[0], lekua: '' }], null]) {
      await assert.rejects(call(db, 'save', { slots: bad, version: 1 }), error => error.code === '22023');
    }
    for (const week of ['2028-02-30', '2028-02-29', 'invalid']) {
      await assert.rejects(call(db, 'publish', { week_start: week, version: 1 }), error => error.code === '22023');
    }
    await db.exec(`CREATE FUNCTION fail_second_training() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.data_ordua='2028-02-29T19:00' THEN RAISE EXCEPTION 'Fixture failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON saioak FOR EACH ROW EXECUTE FUNCTION fail_second_training();`);
    const before = (await db.query('SELECT count(*)::int AS n FROM saioak')).rows[0].n;
    await assert.rejects(call(db, 'publish', { version: 1 }));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM saioak')).rows[0].n, before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM team_training_publications')).rows[0].n, 0);
    const rights = (await db.query("SELECT has_function_privilege('anon','weekly_training_action(integer,integer,text,jsonb)','execute') AS rpc,has_table_privilege('authenticated','team_training_schedules','select') AS read")).rows[0];
    assert.equal(rights.rpc, false);
    assert.equal(rights.read, false);
  } finally { await db.close(); }
});

test('published trainings enter the player agenda and send one notification per new training', async () => {
  const db = await fixture();
  try {
    const week = (await db.query("SELECT to_char(current_date+7-(extract(isodow FROM current_date)::integer-1),'YYYY-MM-DD') AS week")).rows[0].week;
    await db.exec(`INSERT INTO portal_player_links(player_id,team_id,user_id) VALUES(10,7,2);
      INSERT INTO api_sessions VALUES(repeat('b',64),2,extract(epoch FROM now())::bigint+3600);
      INSERT INTO push_subscriptions(user_id,device_hash,session_hash,endpoint,p256dh,auth)
      VALUES(2,repeat('2',64),repeat('b',64),'https://fcm.googleapis.com/fixture','fixture','fixture');`);
    await call(db, 'save', { slots, version: 0, week_start: week });
    const first = await call(db, 'publish', { version: 1, week_start: week });
    assert.equal(first.created_ids.length, 3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM push_events')).rows[0].n, 3);
    const agenda = (await db.query("SELECT player_portal_action(2,'portal_player_snapshot','{\"player_id\":10}'::jsonb) AS result")).rows[0].result;
    assert(first.created_ids.every(id => agenda.sessions.some(session => session.id === id)));
    await call(db, 'publish', { version: 1, week_start: week });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM push_events')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('the gateway supplies the authenticated user and hides unexpected database errors', async () => {
  const context = {};
  vm.createContext(context);
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../weekly-training-actions.ts'), 'utf8'));
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nthis.handle=handleWeeklyTrainingAction;', context);
  let parameters;
  const respond = (status, body) => ({ status, body });
  const client = { rpc: async (name, data) => { parameters = data; return { data: { version: 1 } }; } };
  assert.equal((await context.handle({ action: 'weekly_training_get', team_id: 7, p_user: 99, user_id: 99 }, client, 1, respond)).status, 200);
  assert.equal(parameters.p_user, 1);
  const failed = await context.handle({ action: 'weekly_training_get', team_id: 7 }, { rpc: async () => ({ error: { code: 'XX000', message: 'PRIVATE' } }) }, 1, respond);
  assert.equal(failed.status, 500);
  assert(!JSON.stringify(failed).includes('PRIVATE'));
});
