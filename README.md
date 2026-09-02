# google-tag-manager

Google Tag Manager template for ClickPatrol traffic quality.

The same tag also sends conversions when it sees a `ClickPatrol_Conversion`
dataLayer event. Add a Custom Event trigger with that name, next to All Pages.

```javascript
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({
  event: 'ClickPatrol_Conversion',
  conversion_id: 'trial_started',
  conversion_type: 'lead',
  conversion_value: 149.95,
  conversion_currency: 'EUR'
});
```

`conversion_type` must be `lead` or `purchase`. The tag fills click ids
from the page URL or first-party ad cookies. Do not use a separate
Custom HTML conversion snippet.
