# Entrenamenduak editatu eta bikoiztu

`login-actions.ts` modulua `metro-api`-ko kredentzial bidezko sarreran deitzen da,
`login(payload, supabase, jsonResponse)` erabiliz. `p_keep_signed_in: true`
aukerak `api_sessions.expires_at` eremuan PostgreSQLko `Infinity` gordetzen du.
Bestela, saioak 12 ordu irauten du. Saioaren egiaztapenek eta push garbiketak
iraungitze-konparazio bera erabiltzen dute. Ez du migraziorik behar.

`match-actions.ts` moduluak `pwa_update_match` ekintza kudeatzen du.
`metro-api`-k `updateMatch(payload, supabase, teamId, jsonResponse)` deitzen du,
saioa eta taldekidetasuna egiaztatu ondoren. Emaitzaz eta estatistikez gain,
`lekua` eremuan `Etxean` edo `Kanpoan` gordetzen du. Eremua bidaltzen ez duten
bertsio zaharrek lehengo tokia mantentzen dute. `metro-api` ere hedatu behar da;
ez du datu-baseko migraziorik behar.

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
eta ondoren `migrations/20261112130000_preserve_callup_responses.sql`,
deialdia editatzean bertan jarraitzen duten jokalarien erantzunak mantentzeko.
Ondoren `metro-api` hedatu eta azkenik webeko bertsioa argitaratu.
`metro-api`-k `portalActions` multzoko ekintzak saioa balioztatu ondoren
`handlePortalAction` funtziora bidaltzen ditu, benetako erabiltzaile-IDarekin.
`player_portal_action` RPCak baimenak eta idazketak transakzio berean ebazten ditu.
Taula berriek RLS dute, eta RPCa service_role rolak bakarrik exekuta dezake.
Jokalarien loturak ez dira `team_memberships` taulan sartzen. Jokalariaren
erantzunak eta benetako asistentzia bereizita gordetzen dira. Snapshotak baimendutako
eremuak bakarrik itzultzen ditu; ez ditu kontaktuak edo entrenatzailearen ohar
pribatuak ematen. Funtzionamendua: [JOKALARIAK.md](../JOKALARIAK.md).

## Web Push

1. Aplikatu `migrations/20261112140000_web_push.sql`.
2. Sortu VAPID gako-pare bat behin bakarrik, `web-push` 4.0.0 paketeko
   `generateVAPIDKeys` erabiliz. Supabaseko sekretuak: `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (aplikazioaren HTTPS helbidea) eta
   `PUSH_WORKER_TOKEN` (ausazko 32 byte). Ez gorde gako pribatuak biltegian.
3. Gorde `PUSH_WORKER_TOKEN` bera Supabase Vault-en,
   `7metro_push_worker_token` izenarekin.
4. `supabase/functions/metro-push/index.ts` fitxak biltegi honetako
   `backend/push-entry.ts` inportatu behar du. Hedatu
   `npx supabase functions deploy metro-push --no-verify-jwt` erabiliz.
   Funtzioak bere autentifikazioa du: sinatutako erabilera bakarreko esnatzeak
   eta administrazio-probetarako sekretua. `?health=1` probak sinadura eta
   zifratzea egiaztatzen ditu, mezurik bidali gabe.
5. `metro-api`-k `pushActions` multzoko eskaerak `getSessionUserId` ondoren
   `handlePushAction`-era bidaltzen ditu, egiaztatutako erabiltzailearekin eta
   saio-tokenarekin. Hedatu `metro-api` ere.
6. Exekutatu `push-scheduler.sql`. pg_net-ek commit ondoren esnatzen du workerra;
   pg_cron-ek minutuero berriz saiatzen du, bidalketarik zain badago.

Taulako triggerrek sortzen dituzte jakinarazpenak, webeko nahiz mahaigaineko
aldaketetarako. Gailu bakoitzeko lehentasunak, saio balioduna eta dagokion taldeko
sarbidea bidali aurretik egiaztatzen dira. Saioa ezabatzean harpidetza kentzen da.
Harpidetzak, gailu-gakoak, jakinarazpenak eta entregak RLS bidez babestuta daude;
workerreko RPCak service_role rolak bakarrik exekuta ditzake.

pg_net-en HTTP ilarak ez du sekretu berrerabilgarririk gordetzen: Vault-eko
gakoarekin sinatutako bi minutuko nonce bat darabil, behin bakarrik onartzen dena.
Gailuko workerreko IndexedDB kontu-loturak beste kontu baterako mezua erakustea
eragozten du. Harpidetza-helbideak push hornitzaile ezagunetara mugatzen dira;
workerrek ez dituzte HTTP birbideratzeak jarraitzen.

Entregak bi minutuko lease batekin hartzen dira, lau bidalketa paralelo gehienez.
Aldi baterako erroreak gehienez bost aldiz berriz saiatzen dira; 404/410 erroreek
harpidetza iraungia kentzen dute. Jakinarazpenak ez dira 24 ordutik aurrera berriz
bidaltzen; providerreko TTL ordu batekoa da. Zazpi eguneko garbiketa dago.
Probak: `npm test` (PostgreSQL ilara, baimenak, erreplay babesa eta benetako Web
Push zifratze/deszifratzea). Erabilera: [JAKINARAZPENAK.md](../JAKINARAZPENAK.md).
