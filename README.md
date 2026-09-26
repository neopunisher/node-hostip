# hostinfo

Geocode IP addresses to city, country, and coordinates using the free, community-built [hostip.info](https://www.hostip.info/) API. Zero dependencies.

```js
import { lookup } from 'hostinfo';

const info = await lookup('8.8.8.8');
// {
//   ip: '8.8.8.8',
//   city: 'Mountain View, CA',
//   country: 'UNITED STATES',
//   countryCode: 'US',
//   latitude: 37.402,
//   longitude: -122.078
// }
```

## Install

```sh
npm install hostinfo
```

Requires Node.js 18 or newer. Works from both ESM (`import`) and CommonJS (`require`), and ships TypeScript types.

## API

### `lookup(ip?, options?) → Promise<HostInfo>`

Looks up an IPv4 address. Omit `ip` to geocode the caller's own public address:

```js
const whereAmI = await lookup();
```

Fields that hostip.info does not know are `null` — for private addresses and unrecognized IPs you'll get `city: null`, `country: null`, and `countryCode: 'XX'`. Coordinates are only present for IPs mapped to a city.

**Options**

| option | default | |
| --- | --- | --- |
| `timeout` | `10000` | Milliseconds before the request aborts. `0` disables. |
| `signal` | – | Your own `AbortSignal`; overrides `timeout`. |
| `endpoint` | `https://api.hostip.info/` | Alternate API base URL. |

Failures (network, HTTP status, unparseable response) reject with a `HostInfoError`; network errors keep the underlying error on `.cause`.

### Callback style

The original 2011 signature still works if you pass a function last:

```js
const { lookup } = require('hostinfo');

lookup('8.8.8.8', (err, info) => {
  if (err) throw err;
  console.log(info.city);
});
```

> **Upgrading from 0.0.2:** the result is now the flat object shown above rather than the raw `xml2js` parse of the API response, and the `request`/`xml2js` dependencies are gone.

## Accuracy

hostip.info is a community-maintained database. It's free and requires no API key, but coverage and accuracy are modest compared to commercial GeoIP databases — treat results as approximate.

## License

MIT © Carter Cole
