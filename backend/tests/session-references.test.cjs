const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');

const source=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../session-references.ts'),'utf8'))
  .replace('export async function','async function');
const context={};vm.createContext(context);vm.runInContext(source+'\nthis.load=addSessionExerciseReferences;',context);

test('team training references include another coach exercises and preserve their boards, order and notes',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE ariketak(id_ariketa integer,id_erabiltzailea integer,izena text,arbela_datuak text);
      INSERT INTO ariketak VALUES(1,9,'Shared drill','{"animazioa":[{"u1":{"x":10,"y":20}},{"u1":{"x":30,"y":40}}]}'),
        (2,10,'Own library',NULL),(3,9,'Unused private drill',NULL),(4,11,'Other team drill',NULL);`);
    const details=[{id_saio:100,id_ariketa:null,taldea:'Beroketa',ordena:1},
      {id_saio:100,id_ariketa:1,iraupena_minutuak:10,aldaerak:'First notes',ordena:2},
      {id_saio:100,id_ariketa:1,iraupena_minutuak:15,aldaerak:'Second notes',ordena:3},
      {id_saio:200,id_ariketa:4,ordena:1}];
    const own=(await db.query('SELECT * FROM ariketak WHERE id_erabiltzailea=10')).rows;
    const tables={saioak:[{id_saio:100,id_taldea:7}],saio_xehetasuna:details,ariketak:own};
    const calls=[];
    const result=await context.load(tables,async ids=>{
      calls.push(Array.from(ids));return{data:(await db.query('SELECT * FROM ariketak WHERE id_ariketa=ANY($1::integer[])',[Array.from(ids)])).rows,error:null};
    });
    assert.equal(result,null);assert.deepEqual(calls,[[1]]);
    assert.deepEqual(tables.ariketak,own);
    assert.deepEqual(tables.saio_xehetasuna,details.slice(0,3));
    assert.equal(tables.saio_reference_ariketak.length,1);
    assert.equal(tables.saio_reference_ariketak[0].id_erabiltzailea,9);
    assert.equal(JSON.parse(tables.saio_reference_ariketak[0].arbela_datuak).animazioa.length,2);
  }finally{await db.close();}
});

test('references handle empty trainings, missing exercises and storage failures without broadening access',async()=>{
  const tables={saioak:[{id_saio:100}],saio_xehetasuna:[{id_saio:100,id_ariketa:1},{id_saio:100,id_ariketa:null}],ariketak:[]};
  const original=JSON.stringify(tables);
  assert.equal(await context.load(tables,async()=>({data:[],error:'Storage unavailable'})),'Storage unavailable');
  assert.equal(JSON.stringify(tables),original);
  await context.load(tables,async()=>({data:[{id_ariketa:999,izena:'Unrequested'}],error:null}));
  assert.equal(tables.saio_reference_ariketak.length,0);assert.equal(tables.saio_xehetasuna.length,1);
  const empty={saioak:[],saio_xehetasuna:[{id_saio:200,id_ariketa:4}]};
  await context.load(empty,async ids=>{assert.equal(ids.length,0);return{data:[],error:null};});
  assert.equal(empty.saio_xehetasuna.length,0);assert.equal(empty.saio_reference_ariketak.length,0);
});
