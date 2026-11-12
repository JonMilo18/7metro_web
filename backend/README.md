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


`player-actions.ts` moduluak `pwa_update_player` ekintza eskaintzen du.
`metro-api`-ko `teamActions` eta `pwaActions` multzoetan erregistratuta dago;
saioa eta taldekidetasuna egiaztatuta, `updatePlayer(payload, supabase, teamId,
jsonResponse)` deitzen du. Jokalariaren identifikatzailea eta taldea erabiliz
editagarriak diren eremuak bakarrik eguneratzen ditu, jabea eta estatistiken
loturak aldatu gabe. `expected` aurreko datuekin alderatzen du aldaketa
gatazkatsuak saihesteko. Ez du migraziorik behar; `metro-api` ere hedatu behar da.

Jokalarien aplikazioa: `portal-actions.ts` eta
`migrations/20261112120000_player_portal.sql`. Lehenik SQL migrazioa aplikatu,
ondoren `metro-api` hedatu eta azkenik webeko bertsioa argitaratu.
`metro-api`-k `portalActions` multzoko ekintzak saioa balioztatu ondoren
`handlePortalAction` funtziora bidaltzen ditu, benetako erabiltzaile-IDarekin.
`player_portal_action` RPCak baimenak eta idazketak transakzio berean ebazten ditu.
Taula berriek RLS dute, eta RPCa service_role rolak bakarrik exekuta dezake.
Jokalarien loturak ez dira `team_memberships` taulan sartzen. Jokalariaren
erantzunak eta benetako asistentzia bereizita gordetzen dira. Snapshotak baimendutako
eremuak bakarrik itzultzen ditu; ez ditu kontaktuak edo entrenatzailearen ohar
pribatuak ematen. Funtzionamendua: [JOKALARIAK.md](../JOKALARIAK.md).
