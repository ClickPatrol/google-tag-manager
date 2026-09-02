// Minimal GTM sandbox harness so the conversion paths can be executed locally.
// Not a replacement for the GTM test runner; it exists to prove the dedupe
// guards under a shared window across two template executions.
const fs = require('fs');
const path = require('path');

const tplPath = process.argv[2] || path.join(__dirname, '..', 'template.tpl');
const src = fs.readFileSync(tplPath, 'utf8');
const m = src.split(/^___([A-Z_]+)___$/m);
const sections = {};
for (let i = 1; i < m.length; i += 2) sections[m[i]] = m[i + 1];
const code = sections.SANDBOXED_JS_FOR_WEB_TEMPLATE;

function gtmType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function makeEnv(world, opts) {
  const injected = [];
  const api = {
    getUrl: (c) => (c === 'query' ? (opts.query || '') : (opts.href || 'https://example.com/thanks')),
    injectScript: (url, ok, fail) => {
      injected.push(url);
      if (opts.resolveScript !== false && ok) ok();
    },
    encodeUriComponent: encodeURIComponent,
    decodeUriComponent: decodeURIComponent,
    getCookieValues: (n) => (world.cookies[n] ? [world.cookies[n]] : []),
    setCookie: (n, v) => { world.cookies[n] = v; },
    localStorage: {
      getItem: (k) => (k in world.ls ? world.ls[k] : null),
      setItem: (k, v) => { world.ls[k] = String(v); },
      removeItem: (k) => { delete world.ls[k]; },
    },
    generateRandom: () => 0,
    getTimestampMillis: () => 1000,
    getQueryParameters: (k) => (opts.params && opts.params[k]) || undefined,
    copyFromDataLayer: (k) => (opts.dl && k in opts.dl ? opts.dl[k] : undefined),
    copyFromWindow: (k) => world.win[k],
    setInWindow: (k, v, override) => {
      if (k in world.win && !override) return false;
      world.win[k] = v;
      return true;
    },
    callInWindow: (name, fn, ms) => { if (name === 'setTimeout') world.timers.push(fn); },
    createQueue: () => (o) => world.win.dataLayer.push(o),
    getType: gtmType,
    JSON: JSON,
    Math: Math,
  };
  return { api, injected };
}

function run(world, opts) {
  const { api, injected } = makeEnv(world, opts);
  const data = Object.assign({
    uid: 'TEST-UID-1234',
    gtmOnSuccess: () => { world.success++; },
    gtmOnFailure: () => { world.failure++; },
  }, opts.data || {});
  const fn = new Function('require', 'data', '"use strict";\n' + code + '\n');
  fn((n) => {
    if (!(n in api)) throw new Error('unstubbed API: ' + n);
    return api[n];
  }, data);
  return injected;
}

function newWorld(dl) {
  return { win: { dataLayer: dl || [] }, cookies: { cp_session_id: 'cp_existing_session' }, ls: {}, timers: [], success: 0, failure: 0 };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}
const conv = (urls) => urls.filter((u) => u.indexOf('conversion.clckptrl.com') === 0 || u.indexOf('https://conversion.clckptrl.com') === 0);

// 1. All Pages, conversion already sitting in the dataLayer.
{
  const w = newWorld([{ event: 'ClickPatrol_Conversion', conversion_id: 'order_10042', conversion_type: 'purchase' }]);
  const urls = run(w, { dl: { event: 'gtm.js' } });
  const c = conv(urls);
  check('All Pages picks up a conversion already in the dataLayer', c.length === 1 && c[0].includes('conversion_type=TRANSACTION'), JSON.stringify(c));
  check('All Pages still calls trck-002', urls.some((u) => u.includes('trck-002')), '');
}

// 2. All Pages, push arrives afterwards, watch tick sends it.
{
  const w = newWorld([{ event: 'gtm.js' }]);
  const urls = run(w, { dl: { event: 'gtm.js' } });
  check('no conversion before the push', conv(urls).length === 0, '');
  w.win.dataLayer.push({ event: 'ClickPatrol_Conversion', conversion_id: 'later_lead', conversion_type: 'lead' });
  w.timers.shift()();
  const c = conv(urls);
  check('watch sends a conversion pushed after the first fire', c.length === 1 && c[0].includes('conversion_id=later_lead&conversion_type=LEAD'), JSON.stringify(c));
}

// 3. Both routes: watch installed on All Pages, then a Custom Event trigger fire.
{
  const w = newWorld([{ event: 'gtm.js' }]);
  const first = run(w, { dl: { event: 'gtm.js' } });
  const item = { event: 'ClickPatrol_Conversion', conversion_id: 'order_777', conversion_type: 'purchase' };
  w.win.dataLayer.push(item);
  // Custom Event trigger fires its own execution, script still in flight.
  const second = run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'order_777', conversion_type: 'purchase' }, resolveScript: false });
  // Watch tick runs afterwards and sees the same item.
  w.timers.shift()();
  const total = conv(first).length + conv(second).length;
  check('trigger + watch send the conversion exactly once', total === 1, 'sent ' + total + ' time(s)');
}

// 4. Session marker is written even when the pixel never responds.
{
  const w = newWorld([]);
  run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' }, resolveScript: false });
  check('cp_conv is marked before the pixel responds', w.ls.cp_conv === '_session.trial_started', String(w.ls.cp_conv));
}

// 5. Refresh in the same session does not resend.
{
  const w = newWorld([]);
  const a = run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'order_10042', conversion_type: 'purchase' } });
  const w2 = { ...newWorld([]), ls: w.ls };
  const b = run(w2, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'order_10042', conversion_type: 'purchase' } });
  check('a refresh in the same session is ignored', conv(a).length === 1 && conv(b).length === 0, '');
}

// 6. Watch installs only once across executions.
{
  const w = newWorld([{ event: 'gtm.js' }]);
  run(w, { dl: { event: 'gtm.js' } });
  const afterFirst = w.timers.length;
  run(w, { dl: { event: 'gtm.js' } });
  check('watch installs once per page', afterFirst === 1 && w.timers.length === 1, 'timers ' + w.timers.length);
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail && !r.pass ? '  [' + r.detail + ']' : ''));
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
