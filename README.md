# google-tag-manager

Google Tag Manager template for ClickPatrol traffic quality.

The same tag also sends conversions when it sees a `ClickPatrol_Conversion`
dataLayer event. Add a Custom Event trigger with that name, next to All Pages.

Do not use a separate Custom HTML conversion snippet.

## Conversion event

Push this after a confirmed lead or purchase. `conversion_type` must be
`lead` or `purchase`. The tag fills click ids from the page URL or
first-party ad cookies.

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

The ClickPatrol tag does not listen to `purchase` or `generate_lead` by
itself. Your existing conversion tag, thank-you page, or GTM Custom HTML
pushes `ClickPatrol_Conversion` when those events fire.

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

1. Keep the ClickPatrol Ad Traffic Quality tag.
2. Add a Custom Event trigger, event name `ClickPatrol_Conversion`.
3. Attach that trigger to the same tag, next to All Pages.
4. Let your purchase / lead tag push the event above, or add a small
   Custom HTML tag on those same triggers that only does the push.

Find the Google Ads label under Tools > Conversions > the conversion
action > Tag setup. It is the second part of `AW-XXXXXXX/LABEL`.

Docs: https://docs.clickpatrol.com/conversion-tracking/
