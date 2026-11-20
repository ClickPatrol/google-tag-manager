# google-tag-manager

Google Tag Manager template for ClickPatrol traffic quality.

The same tag also sends conversions, with their click ids, to
`https://conversion.clckptrl.com/www/`, the endpoint the retired
conversion-tracking template used. GA4 `purchase` and `generate_lead` events count
by default. No Custom HTML conversion snippet is needed.

## Content Security Policy

A site with a Content Security Policy blocks the tag unless ClickPatrol
is allowed to load scripts. Without it, no visit is classified and no
conversion is sent. The console shows:

```
Loading the script 'https://trck-002.clckptrl.com/?uid=...' violates the following Content Security Policy directive: "script-src-elem ..."
```

Add both hosts to `script-src`, and to `script-src-elem` when the policy
has that directive:

```
https://trck-002.clckptrl.com https://conversion.clckptrl.com
```

`https://*.clckptrl.com` works too. The script trck-002 returns only
pushes an event to the `dataLayer` and loads nothing from other domains,
so no other directive needs a change.

## Consent storage and Adobe Launch

`Consent & storage mode` defaults to `full`: the same 400-day visitor cookie, 24-hour session cookie, classification cache and localStorage backup as before.

`session` caps ClickPatrol cookies at 24 hours and skips localStorage. Advertising cookies keep their own lifetime. `memory` writes no ClickPatrol cookies and no localStorage. Existing ad cookies such as `_gcl_aw` are still read so a conversion keeps its click id. After consent, `window.ClickPatrol.setStorageMode('full')` writes the ids from that page. `setStorageMode('memory')` deletes the ClickPatrol cookies and localStorage keys.

Every classification sets `window.clickPatrolClassification` and `window.ClickPatrol.classification` to `{ event, traffic, audience }`. When `adobeDataLayer` exists, the tag pushes `{ event, clickPatrol: { traffic, audience } }`. `Trigger Adobe Launch Direct Call` is off by default. Turn it on only when `_satellite.track` should fire. That call gets the same nested payload. `window.ClickPatrol.trackConversion({...})` sends a conversion without a dataLayer push. `window.ClickPatrol.version` is the template version.

## Conversion event

Push this after a confirmed lead or purchase. `conversion_type` must be
`lead` or `purchase`. The tag fills click ids from the page URL or
first-party ad cookies. On a later page, gclid comes from `_gcl_aw`,
wbraid from `_gcl_gb` and gbraid from `_gcl_ag`. Those cookies are
written by the Google tag. This tag only reads them.

```javascript
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'ClickPatrol_Conversion',
  conversion_id: 'order_10042',
  conversion_label: 'AbCdEfGhIjk',
  conversion_type: 'purchase',
  conversion_value: 189.00,
  conversion_currency: 'EUR'
});
```

- `conversion_id` is this one conversion (order id, or a stable event
  name). The tag uses it to ignore a refresh.
- `conversion_label` is the Google Ads conversion label, the part after
  the slash in `AW-123456789/AbCdEfGhIjk`. Optional. Send it if you want
  to match or upload this conversion to that Google Ads action.
- `conversion_type` is `lead` or `purchase`.

## GA4 events and your own events

`Send GA4 purchase and generate_lead events as ClickPatrol conversions`
is on by default (1.2.0). A `purchase` event is sent as a purchase, a
`generate_lead` event as a lead. `conversion_id` is `transaction_id`
(top level or in `ecommerce`), otherwise the event name. `value` and
`currency` come from the same place. Add your own event names under
`Other conversion events`, each with type lead or purchase.

A lead without `transaction_id` uses the event name as `conversion_id`,
so with deduplication on, one lead per event name counts per session.
Push `ClickPatrol_Conversion` with your own unique `conversion_id` when
every lead must count.

`gtm.*` and `ClickPatrol_*` events never count as a conversion.

## Thank-you pages

Used the retired ClickPatrol conversion template on a Page View trigger
of a thank-you page? Add that page under `Thank-you pages`: the text the
URL contains (for example `/thank-you` or `/bedankt`) and the type, lead
or purchase. A page view of a matching URL sends one conversion, with the
page path as `conversion_id`. Matching ignores upper and lower case.
Available from 1.2.1. Use a row or the GA4 event for the same conversion,
not both, or it counts twice.

Upgrading from 1.1.0: if you already push `ClickPatrol_Conversion` for
the same purchase or lead, give it the same `conversion_id` as the GA4
`transaction_id`, or turn the GA4 checkbox off. Otherwise one order can
count twice.

## Example triggers

Use only hard conversions. Skip page views, form starts, and add-to-cart.

### Purchase (ecommerce)

Typical GTM / GA4 events: `purchase`, `Purchase Completed`.

```javascript
window.dataLayer.push({
  event: 'ClickPatrol_Conversion',
  conversion_id: 'order_10042',
  conversion_label: 'AbCdEfGhIjk',
  conversion_type: 'purchase',
  conversion_value: 189.00,
  conversion_currency: 'EUR'
});
```

Fire this from the same trigger as your purchase tag, or from the
thank-you page after the order is confirmed.

### Lead (lead gen)

Typical GTM / GA4 events: `generate_lead`, `Lead Submitted`,
`form_submit` (only after a successful submit), `contact`.

```javascript
window.dataLayer.push({
  event: 'ClickPatrol_Conversion',
  conversion_id: 'demo_request',
  conversion_label: 'XyZLabel123',
  conversion_type: 'lead'
});
```

### Trial start or signup

Treat these as a lead unless money changed hands.

Typical events: `sign_up`, `trial_started`, `Trial Started`.

```javascript
window.dataLayer.push({
  event: 'ClickPatrol_Conversion',
  conversion_id: 'trial_started',
  conversion_type: 'lead',
  conversion_value: 0,
  conversion_currency: 'EUR'
});
```

A trial without a Google Ads action can omit `conversion_label`.

## GTM setup

1. Keep the ClickPatrol Ad Traffic Quality tag on All Pages. That fire
   picks up conversion events already in the dataLayer and the ones
   pushed while the page is still loading (until `gtm.load`), such as a
   thank-you page.
2. For a conversion that happens after the page has loaded, such as a
   form that submits without a page change, add that event's Custom
   Event trigger to this same tag. Reuse the trigger of your Google Ads
   or GA4 conversion tag (`purchase`, `generate_lead`, your own event),
   or a trigger on `ClickPatrol_Conversion`.

Running both routes is safe, because the tag claims each
`conversion_id` once per page load and once per session.

Before 1.2.0 the All Pages fire watched the dataLayer for the lifetime of
the page with a `callLater` loop (the sandbox has no delayed timer and no
dataLayer listener). 1.2.0 stops that watch at `gtm.load`, so the tag no
longer runs work on every turn of the event loop after the page loaded.

Find the Google Ads label under Tools > Conversions > the conversion
action > Tag setup. It is the second part of `AW-XXXXXXX/LABEL`.

Docs: https://docs.clickpatrol.com/conversion-tracking/
