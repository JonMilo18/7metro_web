const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const context={};vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(require.resolve('../player-actions.ts'),'utf8')).replace('export async function','async function')+'\nthis.update = updatePlayer;',context);
const respond=(status,body)=>({status,body});
function fixture(){
 const row={id_jokalaria:3,id_taldea:7,id_erabiltzailea:8,izena:'Ane',abizena:null,dortsala:0,posizioa:null,egoera:'Erabilgarri',jaiotze_data:null,altuera_cm:null,pisua_kg:null,eskua:null,telefonoa:null,emaila:null,oharrak:null};
 const {id_jokalaria,id_taldea,id_erabiltzailea,...expected}=row;
 const payload={...expected,id:3,expected:{...expected},izena:'  Jon  ',dortsala:9,id_taldea:999,id_erabiltzailea:999};
 let writes=0;
 const supabase={from(table){assert.equal(table,'jokalariak');let update,conditions=[];return {update(value){update=value;return this},eq(key,value){conditions.push([key,value]);return this},is(key,value){conditions.push([key,value]);return this},select(){return this},async maybeSingle(){if(!conditions.every(([k,v])=>row[k]===v))return {data:null};Object.assign(row,update);writes++;return {data:{id_jokalaria:3}}}}}};
 return {row,payload,supabase,writes:()=>writes};
}
test('player edit is scoped to the existing player and team, preserves ownership and returns normalized fields',async()=>{
 const f=fixture(),response=await context.update(f.payload,f.supabase,7,respond);
 assert.equal(response.status,200);assert.equal(f.row.izena,'Jon');assert.equal(f.row.dortsala,9);
 assert.equal(f.row.id_taldea,7);assert.equal(f.row.id_erabiltzailea,8);assert.equal(f.row.id_jokalaria,3);
 assert.equal(response.body.player.telefonoa,null);assert.equal(f.writes(),1);
});
test('stale edits and other-team edits never overwrite player data',async()=>{
 for(const changed of ['team','snapshot']){const f=fixture();if(changed==='snapshot')f.row.oharrak='Updated elsewhere';
  const result=await context.update(f.payload,f.supabase,changed==='team'?99:7,respond);
  assert.equal(result.status,409);assert.equal(f.writes(),0);assert.equal(f.row.izena,'Ane');}
});
test('invalid player identifiers, dates and measurements are rejected before writes',async()=>{
 for(const changes of [{id:0},{expected:{}},{izena:''},{dortsala:1000},{dortsala:true},{dortsala:1.5},{altuera_cm:99},{pisua_kg:'NaN'},{jaiotze_data:'2026-02-30'}]){
  const f=fixture();Object.assign(f.payload,changes);assert.equal((await context.update(f.payload,f.supabase,7,respond)).status,400);assert.equal(f.writes(),0);
 }
});
