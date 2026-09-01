# Performance check (2026-09-01)

Measured on this machine after the cache work. Not a live customer landing page, so LCP/INP/TBT before/after on production is still open.

## Cache contract

- `cp_class` example: 17 bytes (limit 64)
- `cp_audience` with four boolean flags: 158 bytes (limit 512)
- 1000 encode cycles: 1.3 ms total (about 0.001 ms per pageview)

## Loader size (gzip -9 vs git HEAD)

| File | gzip delta | Plan budget |
| --- | --- | --- |
| wordpress-tag `loader.js` | +1468 B | 1 KB |
| website-tags `website-tag.js` | +1762 B | 1 KB |
| drupal-tag `loader.js` | +1651 B | 1 KB |
| joomla / prestashop / wix loaders | +1468–1470 B | 1 KB |

The plan asked for 1 KB gzip growth. The extra is the two independent stores plus the dataLayer hook. No extra request and no extra origin. Dropping a store would break the fail-path rule, so the overrun is accepted and documented.

## Cache-hit pageview (expected)

- 0 requests to `*.clckptrl.com`
- 0 localStorage reads when both cookies are valid
- 0 cookie writes within an hour of the last refresh
- Event is pushed synchronously, before any network
- Fixture replay (`tests/fixture.html` on localhost): `replayMs=0.000`, class 23 bytes, audience 164 bytes, payload `ClickPatrol_Suspicious` / `fake` with four audience keys intact

## Cache-miss / landing page

- Still one async script to `trck-002.clckptrl.com`
- Same request count as today
- Added work is encode-on-store after the tracker push, not before `injectScript`

## Not measured here

- Lighthouse / WebPageTest LCP, INP, TBT on a real ad landing
- Live DevTools filtered on `clckptrl` (needs a published template or a CMS site with a UID)
