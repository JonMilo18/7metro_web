# Entrenamenduak editatu eta bikoiztu

`session-actions.ts` moduluak `pwa_get_session`, `pwa_update_session` eta
`pwa_duplicate_session` ekintzak kudeatzen ditu. Ez da PWAren fitxategi publikoetan
argitaratzen; Supabaseko `metro-api` funtzioan erabiltzen da.

Proiektu nagusiko `supabase/functions/metro-api/index.ts` fitxategiak modulua
inportatzen du `../../../pwa/7metro_web/backend/session-actions.ts` bidetik.
Hiru ekintzak `teamActions` eta `pwaActions` zerrendetan egon behar dira.
Autentifikazioa eta taldekidetasuna egiaztatu ondoren:

```ts
if (["pwa_get_session", "pwa_update_session", "pwa_duplicate_session"].includes(String(payload.action))) {
  return await handleSessionAction(payload, supabase, teamId, userId, jsonResponse);
}
```

Aplikatu `migrations/20261112_training_editing.sql` backend berria argitaratu
aurretik. `save_team_session` funtzioa `service_role` rolak bakarrik exekuta dezake;
baimenak berriro egiaztatzen ditu, eta saioa eta xehetasunak transakzio berean
gordetzen ditu. Aurreko argazkiarekin alderatzen du, beste gailuko aldaketak
oharkabean gainidaztea eragozteko.

Editatzeak saioaren identifikatzailea, jabea, aurreikusitako RPEa, asistentzia eta
plangintza-loturak mantentzen ditu. Bikoizteak saio berria sortzen du, asistentzia
eta plangintza-loturak kopiatu gabe. Ariketen ordena, tarteak, oharrak eta
`paraleloa` balioak mantentzen dira.

Probak: Node.js 24 edo berriagoa erabiliz, `npm ci` eta `npm test`.
PostgreSQL motor lokala erabiltzen dute (PGlite), benetako datuak ukitu gabe.
Editatzea, bikoiztea, baimenak, aldaketa gatazkatsuak eta gordetze-erroreen
aurreko transakzio osoaren leheneratzea egiaztatzen dituzte.

`report-actions.ts` moduluak `pwa_update_match_notes` ekintza gehitzen du.
`metro-api`-k modulu horretako `saveMatchReportNotes` funtzioa deitzen du,
autentifikazioa eta taldekidetasuna egiaztatu ondoren. `partidak.partida_analisia`
eremua bakarrik eguneratzen du; aurreko balioarekin alderatzen du beste gailuko
oharrak ustekabean gainidaztea eragozteko. Ez du beste migraziorik behar.


`friend-search.ts` moduluak `friends_search` ekintza eskaintzen du.
`metro-api`-ko `socialActions` multzoan erregistratuta dago eta, saioa
balioztatu ondoren, `searchFriendUsers(payload, supabase, userId, jsonResponse)`
deitzen du. `query` testuaren arabera gehienez zortzi erabiltzaile-izen itzultzen
ditu; norberaren kontua baztertzen du eta ez du kontaktu-daturik itzultzen.
Ez du datu-baseko migraziorik behar. Webeko argitalpenaz gain, `metro-api`
funtzioa ere hedatu behar da: `npx supabase functions deploy metro-api`.
