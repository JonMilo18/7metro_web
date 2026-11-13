const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');

const context = { crypto: crypto.webcrypto, Uint8Array, TextEncoder, btoa, console };
vm.createContext(context);
const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../login-actions.ts'), 'utf8'));
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace('export ', '') + '\nthis.login = login;', context);
const respond = (status, body) => ({ status, body });
const credentials = { p_usuario: 'coach', p_pasahitza: 'fixture-password' };

test('persistent and ordinary logins store hashed tokens with the requested lifetime', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE api_sessions(token_hash text PRIMARY KEY, user_id integer, expires_at double precision NOT NULL)');
    let inserted;
    const client = {
      rpc: async () => ({ data: true }),
      from(table) {
        if (table === 'erabiltzaileak') {
          return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id_erabiltzailea: 1, izena: 'coach' } }) };
        }
        return { insert: async (row) => {
          inserted = row;
          // Exercise PostgreSQL's JSON-to-float conversion used by PostgREST.
          await db.query('INSERT INTO api_sessions SELECT * FROM jsonb_populate_record(NULL::api_sessions, $1::jsonb)', [JSON.stringify(row)]);
          return { error: null };
        } };
      }
    };
    for (const keep of [undefined, false, true]) {
      const result = await context.login({ ...credentials, ...(keep === undefined ? {} : { p_keep_signed_in: keep }) }, client, respond);
      assert.equal(result.status, 200);
      assert.equal(inserted.token_hash, crypto.createHash('sha256').update(result.body.token).digest('hex'));
      assert(!JSON.stringify(inserted).includes(credentials.p_pasahitza));
      const expiry = (await db.query("SELECT expires_at::text AS value, expires_at > extract(epoch FROM now()) + 43260 AS after_twelve_hours FROM api_sessions WHERE token_hash=$1", [inserted.token_hash])).rows[0];
      assert.equal(expiry.after_twelve_hours, keep === true);
      if (keep === true) {
        assert.equal(expiry.value, 'Infinity');
        assert.equal(result.body.expires_in, null);
      } else {
        assert.equal(result.body.expires_in, 43200);
        assert(Math.abs(inserted.expires_at - Date.now() / 1000 - 43200) < 5);
      }
      await db.query('DELETE FROM api_sessions WHERE token_hash=$1', [inserted.token_hash]);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM api_sessions')).rows[0].n, 0);
    }
  } finally { await db.close(); }
});

test('persistent sessions require valid credentials and an explicit boolean choice', async () => {
  let attempts = 0;
  const client = { rpc: async () => { attempts++; return { data: false }; } };
  assert.equal((await context.login({ ...credentials, p_keep_signed_in: 'true' }, client, respond)).status, 400);
  assert.equal(attempts, 0);
  assert.equal((await context.login({ ...credentials, p_keep_signed_in: true }, client, respond)).status, 401);
  assert.equal(attempts, 1);
});
