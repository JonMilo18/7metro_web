const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {stripTypeScriptTypes}=require('node:module');
const model=require('../../insights-data.js');

function fixture(){
 const event=(type,side='geurea',id=1,extra={})=>({type,taldea:side,player_id:id,minute:3,...extra});
 const mapped=event('gol','geurea',1,{shot_from:[.2,.4],shot_to:[.5,.5]});
 const match={id_partida:1,data_ordua:'2026-11-10T18:00',aurkaria:'Gola',emaitza_geurea:8,emaitza_aurkaria:4,estatistika_aurreratuak:JSON.stringify({event_records:[mapped,{...mapped},event('penalti_gol'),event('gol','geurea',null),event('gol','aurkaria',null,{aurkaria:{zenbakia:'9',izena:'Iñaki'}}),event('jaurtiketa','aurkaria',null,{aurkaria:{zenbakia:'9',izena:'Iñaki'}}),event('penalti_gol','aurkaria',null),event('2min','aurkaria',null,{aurkaria:{}})]})};
 return{jokalariak:[{id_jokalaria:1,izena:'Ane',abizena:'Ñandú',dortsala:7},{id_jokalaria:2,izena:'Zero',dortsala:8}],partidak:[match],partida_jokalariak:[{id_partida:1,id_jokalaria:1,golak:3,jaurtiketak:5},{id_partida:1,id_jokalaria:2,golak:0,jaurtiketak:0}],partidu_zigorrak:[{id_partida:1,id_jokalaria:1,mota:'horia'}],partidu_jaurtiketak:[1,2].map(n=>({id_partida:1,id_jokalaria:1,mota:'gol',taldea:'geurea',minutua:3,jatorri_x:.2,jatorri_y:.4,helburu_x:.5,helburu_y:.5})),saioak:[1,2,3].map(id=>({id_saio:id,data_ordua:'2026-11-0'+id+'T18:00'})),saio_bertaratzea:[{id_saio:1,id_jokalaria:1,bertaratu:1,atzerapena_min:5},{id_saio:2,id_jokalaria:1,bertaratu:0}]};
}
test('report uses aggregate own stats, keeps unassigned shots and never doubles mapped events',()=>{
 const tables=fixture(),report=model.breakdown(tables.partidak[0],tables);
 assert.equal(report.mapped.length,2);assert.equal(report.home.length,2);
 assert.equal(report.home[0].goals,3);assert.equal(report.home[0].shots,5);assert.equal(report.home[0].penaltyGoals,1);
 assert.equal(report.homeTotal.goals,4);assert.equal(report.homeTotal.shots,6);assert.equal(report.homeTotal.efficiency,67);
 assert.equal(report.away.length,1);assert.equal(report.away[0].label,'Iñaki');assert.equal(report.away[0].goals,1);
 assert.equal(report.awayTotal.goals,2);assert.equal(report.awayTotal.shots,3);assert.equal(report.awayTotal.sanctions['2min'],1);
 tables.partidu_jaurtiketak.push({...tables.partidu_jaurtiketak[0]});assert.equal(model.breakdown(tables.partidak[0],tables).mapped.length,3);
 assert.equal(report.home[1].efficiency,null);
});
test('profile excludes unrecorded sessions from absence and attendance denominators',()=>{
 const tables=fixture(),profile=model.profile(1,tables,'all',new Date('2026-11-12T12:00'));
 assert.equal(profile.attendance.length,3);assert.equal(profile.attendanceCount,2);assert.equal(profile.present,1);assert.equal(profile.absent,1);assert.equal(profile.attendanceRate,50);assert.equal(profile.late,1);
 assert.equal(profile.history.length,1);assert.equal(profile.totals.goals,3);assert.equal(profile.totals.sanctions.horia,1);
 assert.equal(model.profile(2,tables,'all',new Date('2026-11-12T12:00')).attendanceRate,null);
 assert.equal(model.profile(99,tables),null);
 tables.partidak.push({...tables.partidak[0],id_partida:2,data_ordua:'2027-11-10'});assert.equal(model.profile(1,tables,'all',new Date('2026-11-12')).history.length,1);
 assert.deepEqual(model.profile(1,tables,'month',new Date('2027-11-12')).history.map(h=>h.match.id_partida),[2]);
});
test('legacy location-only data and broken advanced JSON do not invent goals or rates',()=>{
 const tables=fixture();tables.partidak[0].estatistika_aurreratuak='{invalid';
 const report=model.breakdown(tables.partidak[0],tables);assert.equal(report.mapped.length,2);assert.equal(report.homeTotal.goals,3);assert.equal(report.awayTotal.efficiency,null);
 tables.partida_jokalariak=[];assert.equal(model.breakdown(tables.partidak[0],tables).homeTotal.goals,2);
});

test('report notes update is scoped to team and previous value and touches no statistics',async()=>{
 const context={};vm.createContext(context);const code=stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../report-actions.ts'),'utf8')).replace('export async function','async function');vm.runInContext(code+'\nthis.save=saveMatchReportNotes;',context);
 let calls=[],saved={id_partida:4,partida_analisia:'Gola'};
 const db={from(table){const c={table,filters:[]};calls.push(c);return{update(data){c.update=data;return this},select(){return this},eq(key,value){c.filters.push([key,value]);return this},is(key,value){c.filters.push([key,value]);return this},async maybeSingle(){return{data:saved,error:null}}};}};
 const respond=(status,body)=>({status,body});const payload={id:4,notes:'Gola',expected_notes:null};
 let result=await context.save(payload,db,7,respond);assert.equal(result.status,200);assert.equal(result.body.notes,'Gola');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].update)),{partida_analisia:'Gola'});assert.deepEqual(calls[0].filters,[['id_partida',4],['id_taldea',7],['partida_analisia',null]]);
 for(const invalid of [{notes:'x'.repeat(10001)},{id:-1},{expected_notes:4},{notes:null}]){result=await context.save({...payload,...invalid},db,7,respond);assert.equal(result.status,400);}
 assert.equal(calls.length,1);
 let count=0;db.from=()=>({update(){return this},select(){return this},eq(){return this},is(){return this},async maybeSingle(){return{data:++count===1?null:{id_partida:4},error:null}}});
 result=await context.save(payload,db,7,respond);assert.equal(result.status,409);
 db.from=()=>({update(){return this},select(){return this},eq(){return this},is(){return this},async maybeSingle(){return{data:null,error:null}}});
 result=await context.save(payload,db,7,respond);assert.equal(result.status,404);
});
