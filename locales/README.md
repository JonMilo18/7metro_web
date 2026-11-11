# Hizkuntzak

Euskara (`eu`) da interfazearen jatorrizko hizkuntza. `es.js` fitxategiak
gaztelaniazko katalogoa erregistratzen du `window.SevenMetroLocales.es` gisa.
Katalogo bakoitzak `name`, `locale` eta `messages` eremuak ditu.

Beste hizkuntza bat gehitzeko, sortu katalogo berria eta kargatu `index.html`
fitxategian, `i18n.js` baino lehen. Hizkuntza-hautatzaileak katalogoak automatikoki
zerrendatzen ditu. Gehitu fitxategia `sw.js`-ko `SHELL` zerrendara eta
argitaratze-workflowaren sintaxi-egiaztapenera; eguneratu cache-bertsioa.

Testu estatikoak aplikazioa abiaraztean jasotzen dira. Testu dinamikoetarako,
erabili `t("Jatorrizko mezua")` eta gehitu mezua katalogoetan. Parametroak:
`t("... {name} ...", { name: value })`. Ihes egin emaitzari `esc` erabiliz
HTML barruan txertatzean. Itzulpenik ez badago, jatorrizko testua erakusten da.

Itzuli interfazeko testuak eta aurrez zehaztutako aukeren etiketak. Mantendu
aukeren `value` balioak, API eremuak eta datu-baseko balioak jatorrizko eran.
Erabiltzailearen izenak, kategoriak, oharrak eta bestelako edukiak ez dira
itzuli behar. Hizkuntza aldatzean zirriborroak gordetzen dira eta bistak berriz
marrazten dira, zerbitzaritik datuak berriro eskatu gabe.
