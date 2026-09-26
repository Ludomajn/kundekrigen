/* Kundekrigen — telefonen, der ringer.
 *
 * I stedet for nedkastede kasser står der en telefon på banen og ringer. Går
 * en kunde ind i den, tager den røret: en anden kunde er i den anden ende og
 * siger noget, der udløser en hændelse. Hvilket opkald det bliver, trækkes
 * fra rngSim, så alle klienter får samme besked og samme følger.
 *
 * effekt:
 *   forstaerkning  +2 af et tilfældigt våben til den, der tog røret
 *   recept         +30 tålmodighed
 *   klage          −15 tålmodighed
 *   mursten        mursten regner ned over telefonen
 *   uvejr          vinden springer, og vejret skifter
 *   spam           tre phishing-miner dukker op rundt om på banen
 *   viderestil     den, der tog røret, bliver stillet videre et andet sted hen
 */
'use strict';

export const OPKALD = [
  { effekt: 'forstaerkning', navn: 'Birgit Blodprop',
    tekst: 'Jeg har ringet 47 gange! Nu kommer jeg selv — og jeg har forstærkning med!' },
  { effekt: 'forstaerkning', navn: 'Kaj Ropraktor',
    tekst: 'Min svoger arbejder med IT. Han har sendt noget udstyr med til dig.' },
  { effekt: 'recept', navn: 'Rita Lin',
    tekst: 'Jeg skulle bare lige forny min recept … Nå, det er klaret? I er søde!' },
  { effekt: 'recept', navn: 'Pia Cebo',
    tekst: 'Lægen sagde, jeg skulle drikke mere vand. Jeg har det allerede meget bedre!' },
  { effekt: 'klage', navn: 'Klinik-Karen',
    tekst: 'JEG HAR VÆRET I KØ I TRE TIMER! Det her er en klage. En STOR klage!' },
  { effekt: 'klage', navn: 'Sure Søren',
    tekst: 'Jeres hjemmeside siger "FEJL 40". Hvad betyder det?! Er det MIG?!' },
  { effekt: 'mursten', navn: 'Bent Brud',
    tekst: 'Er det tømrerfirmaet? … Nå. Men jeg kommer alligevel med murstenene!' },
  { effekt: 'uvejr', navn: 'Otto Skop',
    tekst: 'Jeg ringer bare for at sige, at jeres server er nede. Og at det stormer.' },
  { effekt: 'spam', navn: '"Microsoft Support"',
    tekst: 'Tillykke! De har vundet en iPhone! Klik bare på linket i mailen, De får …' },
  { effekt: 'viderestil', navn: 'Omstillingen',
    tekst: 'Et øjeblik, De bliver viderestillet … De er nummer 14 i køen.' },
];

export const TELEFON_MAKS = 2;           // højst så mange telefoner på banen ad gangen
