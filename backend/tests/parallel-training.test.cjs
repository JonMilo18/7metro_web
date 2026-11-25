const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite'),time=require('../../training-time.js');
const drill=(minutes,parallel=0,group=null)=>({id_ariketa:10,iraupena_minutuak:minutes,paraleloa:parallel,taldea:group,aldaerak:'Keep participant notes'});
const separator={id_ariketa:null,is_separator:true,taldea:'Main',iraupena_minutuak:0,paraleloa:0};
const cases=[
 [[],0],[[drill(15),drill(15)],30],[[drill(15),drill(15,1)],15],[[drill(20),drill(15,1),drill(5)],25],
 [[drill(10),drill(15,1),drill(7,true),drill(8)],23],[[drill(10,1),separator,drill(15,1)],25],
 [[drill(10),drill(15,1,'Other phase')],25],[[drill(0),drill(15,1),drill(0,1)],15]
];
test('parallel schedule counts each simultaneous block once, preserves objects and separates phases',()=>{
 for(const [rows,expected]of cases){const before=structuredClone(rows);assert.equal(time.duration(rows),expected);assert.deepEqual(rows,before);}
 const rows=[drill(10),drill(15,1),drill(5)];assert.deepEqual(time.blocks(rows).map(b=>[b.start,b.end,b.entries.length]),[[0,15,2],[15,20,1]]);
 const invalid=[drill(10,1),drill(15,1),separator,drill(20,1)];time.normalize(invalid);assert.deepEqual(invalid.map(d=>d.paraleloa),[0,1,0,0]);
});
test('SQL and browser durations agree; templates and new sessions retain parallel flags, notes and ordering',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'session-templates.test.cjs'),'utf8');
 const migration=()=>fs.readFileSync(path.join(__dirname,'../migrations/20261119200000_session_templates.sql'),'utf8');
 const fixture=new Function('PGlite','fs','path','__dirname','migration',source.slice(source.indexOf('async function fixture()'),source.indexOf('const details='))+'return fixture;')(PGlite,fs,path,__dirname,migration);
 const db=await fixture();try{
 await db.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261125120000_parallel_training_time.sql'),'utf8'));
 for(const [rows,expected]of cases)assert.equal((await db.query('SELECT session_elapsed_minutes($1) n',[JSON.stringify(rows)])).rows[0].n,expected);
 const id=crypto.randomUUID(),details=[{...separator},drill(20,0,'Main'),{...drill(15,1,'Main'),id_ariketa:11},{...separator,taldea:'End'},drill(5,0,'End')];
 const rpc=async(action,payload,data)=>(await db.query('SELECT session_template_action(1,7,$1,$2,$3) result',[action,JSON.stringify(payload),data?JSON.stringify(data):null])).rows[0].result;
 await rpc('save',{template_id:id},{name:'Field players and goalkeepers',session:{lekua:'Court',helburu_taktikoa:'Split groups'},details,total_minutes:25});
 assert.equal((await rpc('list',{})).templates[0].duration,25);
 const saved=await rpc('create',{template_id:id,operation_id:crypto.randomUUID()},{session:{data_ordua:'2026-12-01T18:00',lekua:'Court',helburu_taktikoa:'Split groups',id_mikroziklo:null},details});
 const restored=(await db.query('SELECT * FROM saio_xehetasuna WHERE id_saio=$1 ORDER BY ordena',[saved.id])).rows;
 assert.equal(time.duration(restored),25);assert.equal(restored[2].paraleloa,1);assert.equal(restored[2].aldaerak,'Keep participant notes');assert.deepEqual(restored.map(d=>d.id_ariketa),[null,10,11,null,10]);
 assert.equal((await db.query("SELECT has_function_privilege('anon','session_elapsed_minutes(jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
