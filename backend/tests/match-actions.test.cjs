const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const context={};vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../match-actions.ts'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export ', '')+'\nthis.update=updateMatch;',context);
const payload={id:20,emaitza_geurea:25,emaitza_aurkaria:24,stats:[]};
function database(exists=true){
 const calls=[];
 return {calls,from(table){
  const call={table,filters:[]};calls.push(call);
  const chain={select(){return chain},update(row){call.update=row;return chain},delete(){call.delete=true;return chain},eq(key,value){call.filters.push([key,value]);return chain},maybeSingle:async()=>({data:exists?{id_partida:20}:null}),then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}};
  return chain;
 }};
}
const respond=(status,body)=>({status,body});
test('match venue changes are scoped to the team and preserve scores and detailed shot records',async()=>{
 for(const venue of ['Etxean','Kanpoan',undefined]){
  const db=database();const result=await context.update({...payload,...(venue===undefined?{}:{lekua:venue})},db,7,respond);
  assert.equal(result.status,200);
  const update=db.calls.find(c=>c.update);
  assert.deepEqual(JSON.parse(JSON.stringify(update.filters)),[['id_partida',20],['id_taldea',7]]);
  assert.deepEqual(JSON.parse(JSON.stringify(update.update)),{emaitza_geurea:25,emaitza_aurkaria:24,...(venue===undefined?{}:{lekua:venue})});
  assert(!db.calls.some(c=>c.table==='partidu_jaurtiketak'),'Venue edits must preserve detailed shot locations');
 }
});
test('invalid venues and matches outside the team cannot be updated',async()=>{
 for(const venue of ['Fuera','',null,{},42]){
  const db=database();assert.equal((await context.update({...payload,lekua:venue},db,7,respond)).status,400);assert.equal(db.calls.length,0);
 }
 const db=database(false);assert.equal((await context.update({...payload,lekua:'Kanpoan'},db,7,respond)).status,404);assert(!db.calls.some(c=>c.update));
});
