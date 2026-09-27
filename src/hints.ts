export interface LocationHint {
  /** The part of the hostname that matched, e.g. "lax" or "hstntx". */
  code: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

// Network operators name routers after where they sit, using CLLI codes
// (6 letters, North America), IATA airport codes, or plain city names:
//   108-254-2-1.lightspeed.hstntx.sbcglobal.net   -> Houston
//   ae-5.r21.lsanca07.us.bb.gin.ntt.net           -> Los Angeles
//   be2345.ccr41.fra03.atlas.cogentco.com         -> Frankfurt
// Each row: city, country code, latitude, longitude, space-separated codes.
const PLACES: ReadonlyArray<readonly [string, string, number, number, string]> = [
  // North America
  ['Ashburn, VA', 'US', 39.04, -77.49, 'asbnva ashburn'],
  ['Washington, DC', 'US', 38.9, -77.04, 'washdc iad dca washington'],
  ['Reston, VA', 'US', 38.96, -77.36, 'rstnva reston'],
  ['Richmond, VA', 'US', 37.54, -77.44, 'rcmdva ric richmond'],
  ['Baltimore, MD', 'US', 39.29, -76.61, 'bltmmd bwi baltimore'],
  ['New York, NY', 'US', 40.71, -74.01, 'nycmny nyc jfk lga newyork'],
  ['Newark, NJ', 'US', 40.74, -74.17, 'nwrknj ewr newark'],
  ['Philadelphia, PA', 'US', 39.95, -75.17, 'phlapa phl philadelphia'],
  ['Pittsburgh, PA', 'US', 40.44, -80.0, 'pitbpa pit pittsburgh'],
  ['Boston, MA', 'US', 42.36, -71.06, 'bstnma bos boston'],
  ['Atlanta, GA', 'US', 33.75, -84.39, 'atlnga atl atlanta'],
  ['Miami, FL', 'US', 25.76, -80.19, 'miamfl mia miami'],
  ['Orlando, FL', 'US', 28.54, -81.38, 'orldfl mco orlando'],
  ['Tampa, FL', 'US', 27.95, -82.46, 'tampfl tpa tampa'],
  ['Jacksonville, FL', 'US', 30.33, -81.66, 'jcvlfl jax jacksonville'],
  ['Charlotte, NC', 'US', 35.23, -80.84, 'chrlnc clt charlotte'],
  ['Raleigh, NC', 'US', 35.78, -78.64, 'rlghnc rdu raleigh'],
  ['Nashville, TN', 'US', 36.16, -86.78, 'nsvltn bna nashville'],
  ['Chicago, IL', 'US', 41.88, -87.63, 'chcgil ord mdw chicago'],
  ['Detroit, MI', 'US', 42.33, -83.05, 'dtrtmi dtw detroit'],
  ['Cleveland, OH', 'US', 41.5, -81.69, 'clevoh cle cleveland'],
  ['Columbus, OH', 'US', 39.96, -83.0, 'clmboh cmh columbus'],
  ['Cincinnati, OH', 'US', 39.1, -84.51, 'cncnoh cvg cincinnati'],
  ['Indianapolis, IN', 'US', 39.77, -86.16, 'ipltin ind indianapolis'],
  ['Milwaukee, WI', 'US', 43.04, -87.91, 'mlwkwi mke milwaukee'],
  ['Minneapolis, MN', 'US', 44.98, -93.27, 'mplsmn msp minneapolis'],
  ['St. Louis, MO', 'US', 38.63, -90.2, 'stlsmo stl stlouis'],
  ['Kansas City, MO', 'US', 39.1, -94.58, 'kscymo mci kansascity'],
  ['Omaha, NE', 'US', 41.26, -95.93, 'omahne oma omaha'],
  ['Dallas, TX', 'US', 32.78, -96.8, 'dllstx dfw dal dallas'],
  ['Houston, TX', 'US', 29.76, -95.37, 'hstntx iah hou houston'],
  ['Austin, TX', 'US', 30.27, -97.74, 'austtx aus austin'],
  ['San Antonio, TX', 'US', 29.42, -98.49, 'snantx sanantonio'],
  ['Oklahoma City, OK', 'US', 35.47, -97.52, 'okcyok okc oklahomacity'],
  ['New Orleans, LA', 'US', 29.95, -90.07, 'nworla msy neworleans'],
  ['Denver, CO', 'US', 39.74, -104.99, 'dnvrco den denver'],
  ['Salt Lake City, UT', 'US', 40.76, -111.89, 'slkcut slc saltlake saltlakecity'],
  ['Phoenix, AZ', 'US', 33.45, -112.07, 'phnxaz phx phoenix'],
  ['Las Vegas, NV', 'US', 36.17, -115.14, 'lsvgnv las lasvegas'],
  ['Los Angeles, CA', 'US', 34.05, -118.24, 'lsanca lax losangeles'],
  ['San Diego, CA', 'US', 32.72, -117.16, 'sndgca sandiego'],
  ['San Jose, CA', 'US', 37.34, -121.89, 'snjsca sjc sanjose'],
  ['Santa Clara, CA', 'US', 37.35, -121.96, 'sntcca santaclara'],
  ['Palo Alto, CA', 'US', 37.44, -122.14, 'plalca paloalto'],
  ['San Francisco, CA', 'US', 37.77, -122.42, 'snfcca sfo sanfrancisco'],
  ['Sacramento, CA', 'US', 38.58, -121.49, 'scrmca smf sacramento'],
  ['Portland, OR', 'US', 45.52, -122.68, 'ptldor pdx portland'],
  ['Seattle, WA', 'US', 47.61, -122.33, 'sttlwa sea seattle'],
  ['Honolulu, HI', 'US', 21.31, -157.86, 'hnllhi hnl honolulu'],
  ['Anchorage, AK', 'US', 61.22, -149.9, 'anchak anc anchorage'],
  ['Toronto', 'CA', 43.65, -79.38, 'yyz toronto'],
  ['Montreal', 'CA', 45.5, -73.57, 'mtl yul montreal'],
  ['Vancouver', 'CA', 49.28, -123.12, 'yvr vancouver'],
  ['Mexico City', 'MX', 19.43, -99.13, 'mex mexico'],
  // Europe
  ['London', 'GB', 51.51, -0.13, 'lon lhr london'],
  ['Manchester', 'GB', 53.48, -2.24, 'manchester'],
  ['Dublin', 'IE', 53.35, -6.26, 'dub dublin'],
  ['Amsterdam', 'NL', 52.37, 4.9, 'ams amsterdam'],
  ['Brussels', 'BE', 50.85, 4.35, 'bru brussels'],
  ['Paris', 'FR', 48.86, 2.35, 'par cdg paris'],
  ['Marseille', 'FR', 43.3, 5.37, 'mrs marseille'],
  ['Frankfurt', 'DE', 50.11, 8.68, 'fra frankfurt'],
  ['Berlin', 'DE', 52.52, 13.4, 'ber berlin'],
  ['Munich', 'DE', 48.14, 11.58, 'muc munich muenchen'],
  ['Hamburg', 'DE', 53.55, 9.99, 'hamburg'],
  ['Düsseldorf', 'DE', 51.23, 6.77, 'dus duesseldorf dusseldorf'],
  ['Zurich', 'CH', 47.38, 8.54, 'zrh zurich'],
  ['Geneva', 'CH', 46.2, 6.14, 'gva geneva'],
  ['Vienna', 'AT', 48.21, 16.37, 'vie vienna'],
  ['Milan', 'IT', 45.46, 9.19, 'mxp lin milan'],
  ['Rome', 'IT', 41.9, 12.5, 'fco rome'],
  ['Madrid', 'ES', 40.42, -3.7, 'mad madrid'],
  ['Barcelona', 'ES', 41.39, 2.17, 'bcn barcelona'],
  ['Lisbon', 'PT', 38.72, -9.14, 'lis lisbon'],
  ['Copenhagen', 'DK', 55.68, 12.57, 'cph copenhagen'],
  ['Stockholm', 'SE', 59.33, 18.07, 'arn sto stockholm'],
  ['Oslo', 'NO', 59.91, 10.75, 'osl oslo'],
  ['Helsinki', 'FI', 60.17, 24.94, 'hel helsinki'],
  ['Warsaw', 'PL', 52.23, 21.01, 'waw warsaw'],
  ['Prague', 'CZ', 50.08, 14.44, 'prg prague'],
  ['Budapest', 'HU', 47.5, 19.04, 'bud budapest'],
  ['Bucharest', 'RO', 44.43, 26.1, 'otp bucharest'],
  ['Sofia', 'BG', 42.7, 23.32, 'sof sofia'],
  ['Athens', 'GR', 37.98, 23.73, 'ath athens'],
  ['Istanbul', 'TR', 41.01, 28.98, 'ist istanbul'],
  ['Kyiv', 'UA', 50.45, 30.52, 'kbp kiev kyiv'],
  // Middle East & Africa
  ['Tel Aviv', 'IL', 32.09, 34.78, 'tlv telaviv'],
  ['Dubai', 'AE', 25.2, 55.27, 'dxb dubai'],
  ['Johannesburg', 'ZA', -26.2, 28.05, 'jnb johannesburg'],
  ['Cape Town', 'ZA', -33.92, 18.42, 'cpt capetown'],
  ['Lagos', 'NG', 6.52, 3.38, 'lagos'],
  ['Nairobi', 'KE', -1.29, 36.82, 'nbo nairobi'],
  // Asia-Pacific
  ['Tokyo', 'JP', 35.68, 139.69, 'tyo nrt hnd tokyo'],
  ['Osaka', 'JP', 34.69, 135.5, 'osa kix osaka'],
  ['Seoul', 'KR', 37.57, 126.98, 'sel icn seoul'],
  ['Hong Kong', 'HK', 22.32, 114.17, 'hkg hongkong'],
  ['Taipei', 'TW', 25.03, 121.57, 'tpe taipei'],
  ['Singapore', 'SG', 1.35, 103.82, 'sin singapore'],
  ['Kuala Lumpur', 'MY', 3.14, 101.69, 'kul kualalumpur'],
  ['Bangkok', 'TH', 13.76, 100.5, 'bkk bangkok'],
  ['Jakarta', 'ID', -6.21, 106.85, 'cgk jakarta'],
  ['Manila', 'PH', 14.6, 120.98, 'mnl manila'],
  ['Mumbai', 'IN', 19.08, 72.88, 'bom mumbai'],
  ['Delhi', 'IN', 28.61, 77.21, 'del delhi'],
  ['Chennai', 'IN', 13.08, 80.27, 'maa chennai'],
  ['Sydney', 'AU', -33.87, 151.21, 'syd sydney'],
  ['Melbourne', 'AU', -37.81, 144.96, 'mel melbourne'],
  ['Perth', 'AU', -31.95, 115.86, 'perth'],
  ['Auckland', 'NZ', -36.85, 174.76, 'akl auckland'],
  // South America
  ['São Paulo', 'BR', -23.55, -46.63, 'sao gru saopaulo'],
  ['Rio de Janeiro', 'BR', -22.91, -43.17, 'rio gig riodejaneiro'],
  ['Buenos Aires', 'AR', -34.6, -58.38, 'eze bue buenosaires'],
  ['Santiago', 'CL', -33.45, -70.67, 'scl santiago'],
  ['Bogotá', 'CO', 4.71, -74.07, 'bog bogota'],
  ['Lima', 'PE', -12.05, -77.04, 'lim lima'],
];

// Lower number wins: a 6-letter CLLI code is the most specific, a 3-letter
// airport code the most likely to collide with an unrelated abbreviation.
const CLLI = 0;
const NAME = 1;
const AIRPORT = 2;

const CODES = new Map<string, { rank: number; place: (typeof PLACES)[number] }>();
for (const place of PLACES) {
  const codes = place[4].split(' ');
  // CLLI codes are exactly six letters ending in a two-letter state; the
  // first code on a North American row is always its CLLI code.
  const hasClli = place[1] === 'US' && codes[0]!.length === 6;
  codes.forEach((code, i) => {
    const rank = hasClli && i === 0 ? CLLI : code.length === 3 ? AIRPORT : NAME;
    CODES.set(code, { rank, place });
  });
}

/**
 * Guess where a router or server sits from the location code embedded in its
 * hostname (e.g. "ae-1.r20.lax01.us.bb.gin.ntt.net" → Los Angeles). Returns
 * null when nothing recognizable is found. This is a heuristic: treat it as a
 * hint, not a fact.
 */
export function hintFromHostname(hostname: string): LocationHint | null {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  // The registrable domain ("ntt.net", "cogentco.com") names the operator,
  // not the location, so leave it out.
  const words = labels
    .slice(0, -2)
    .flatMap((label) => label.split(/[^a-z]+/))
    .filter((word) => word.length > 0);

  // Also try adjacent words joined, so "san-jose" and "los-angeles" match.
  const candidates = [
    ...words,
    ...words.slice(1).map((word, i) => words[i] + word),
    ...words.slice(2).map((word, i) => words[i]! + words[i + 1] + word),
  ];

  let best: { code: string; rank: number; place: (typeof PLACES)[number] } | undefined;
  for (const code of candidates) {
    const entry = CODES.get(code);
    // Strict < keeps the leftmost match within a rank.
    if (entry && (best === undefined || entry.rank < best.rank)) best = { code, ...entry };
  }
  if (!best) return null;

  const [city, countryCode, latitude, longitude] = best.place;
  return { code: best.code, city, countryCode, latitude, longitude };
}
