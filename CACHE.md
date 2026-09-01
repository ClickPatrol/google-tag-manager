# Classification cache contract

First-party stores used by the GTM template and the CMS / website loaders.
`trck-002` is unchanged. The GTM tag writes the stores itself after that script loads. Gallery publish of the template is a separate step.

## Cookies and localStorage

| Key | TTL | Contents |
| --- | --- | --- |
| `cp_visitor_id` | 400 days | Visitor id (already live) |
| `cp_session_id` | 24 hours, rolling | Session id (already live) |
| `cp_class` | 24 hours | Event + traffic only |
| `cp_audience` | 24 hours | Opaque audience object |

Flags: `path=/`, `SameSite=Lax`, `Secure` on HTTPS, broadest registrable domain.
Each store has a localStorage key of the same name. Write localStorage only when the value changes.

## `cp_class`

```
1.<L|S>.<s|f>.<last8 of session id>.<timestamp base36>
```

Example for Suspicious / fake: `1.S.f._session.rs`

Hard limit: 64 bytes. Never includes audience data.

## `cp_audience`

```
1.<last8 of session id>.<timestamp base36>.<urlencoded JSON>
```

JSON is the audience object as pushed by `trck-002`, for example:

```json
{"custom_audience_iphone":false,"russia_exclusions":false,"apple_gebruikers":false,"legitieme_audience":false}
```

Cookie is written only when the encoded value is at most 512 bytes. Larger objects stay in localStorage. A parse failure here must not block `cp_class` replay.

## Invalidation

- Session suffix mismatch
- Age over 24 hours
- New click id in the URL: `source`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`, `vd`

Cookie TTL is refreshed at most once per hour. localStorage is not rewritten on that refresh.

## Replay payload

```js
dataLayer.push({
  event: "ClickPatrol_Suspicious",
  traffic: "fake",
  audience: { /* only if cp_audience is valid */ }
});
```
