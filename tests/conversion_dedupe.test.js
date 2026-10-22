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
    setCookie: (n, v, o) => {
      world.cookies = world.cookies || {};
      world.cookieOpts = world.cookieOpts || {};
      world.cookieOpts[n] = o || {};
      const maxAge = o && o['max-age'];
      if (maxAge === 0 || maxAge === '0') {
        delete world.cookies[n];
        return;
      }
      world.cookies[n] = v;
    },
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
    callInWindow: (name, ...args) => {
      const fn = world.win[name];
      if (typeof fn === 'function') return fn(...args);
      return undefined;
    },
    callLater: (fn) => { world.timers.push(fn); },
    createQueue: (qName) => (o) => {
      const target = qName || 'dataLayer';
      world.win[target] = world.win[target] || [];
      world.win[target].push(o);
    },
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

// 6. Later-page Google click ids from the cookies the Google tag writes.
{
  const w = newWorld([]);
  w.cookies._gcl_gb = 'GCL.1730000000.wbraidvalue.label';
  w.cookies._gcl_ag = '2.1.k0AAAAA-gbraid$i1730000000$b1';
  const urls = run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' } });
  const c = conv(urls);
  check('wbraid is the third segment of _gcl_gb', c.length === 1 && c[0].includes('wbraid=wbraidvalue') && c[0].indexOf('wbraidvalue.label') === -1, c[0] || '');
  check('gbraid is the k field of _gcl_ag', c.length === 1 && c[0].includes('gbraid=0AAAAA-gbraid'), c[0] || '');
}

{
  const w = newWorld([]);
  w.cookies._gcl_ag = '2.1.k0AAAAA-gbraid%24i1730000000';
  const urls = run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' } });
  const c = conv(urls);
  check('gbraid still reads when the separator is percent-encoded', c.length === 1 && c[0].includes('gbraid=0AAAAA-gbraid'), c[0] || '');
}

{
  const w = newWorld([]);
  w.cookies._gcl_ag = 'GCL.123.notgbraid';
  w.cookies._gcl_gb = 'rawwbraid';
  w.cookies._gcl_gs = '2.1.k3$i10';
  const urls = run(w, { dl: { event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' } });
  const c = conv(urls);
  const url = c[0] || '';
  check('a mismatched braid cookie is omitted', c.length === 1 && url.indexOf('gbraid=') === -1 && url.indexOf('wbraid=') === -1, url);
}

{
  const w = newWorld([]);
  w.cookies._gcl_ag = '2.1.kcookiegbraid$i1730000000';
  w.cookies._gcl_gb = 'GCL.1730000000.cookiewbraid';
  const urls = run(w, {
    dl: { event: 'ClickPatrol_Conversion', conversion_id: 'trial_started', conversion_type: 'lead' },
    params: { gbraid: 'urlgbraid', wbraid: 'urlwbraid' },
  });
  const c = conv(urls);
  check('URL braid ids win over cookies', c.length === 1 && c[0].includes('gbraid=urlgbraid') && c[0].includes('wbraid=urlwbraid'), c[0] || '');
}

// 7. Watch installs only once across executions.
{
  const w = newWorld([{ event: 'gtm.js' }]);
  run(w, { dl: { event: 'gtm.js' } });
  const afterFirst = w.timers.length;
  run(w, { dl: { event: 'gtm.js' } });
  check('watch installs once per page', afterFirst === 1 && w.timers.length === 1, 'timers ' + w.timers.length);
}

{
  const w = newWorld([{ 'gtm.start': 1000, event: 'gtm.js' }]);
  const urls = run(w, { dl: { event: 'gtm.js' } });
  check('trck-002 waits while gtm.load is not yet in dataLayer', !urls.some((u) => u.includes('trck-002')), urls.join(' '));
  w.win.dataLayer.push({ event: 'gtm.load' });
  let guard = 0;
  while (!urls.some((u) => u.includes('trck-002')) && w.timers.length && guard < 8) {
    w.timers.shift()();
    guard++;
  }
  check('trck-002 loads once gtm.load is pushed to dataLayer', urls.some((u) => u.includes('trck-002')), 'guard ' + guard);
}

// 8. Adobe Launch exposure: clickPatrolClassification, adobeDataLayer, _satellite.track, and ClickPatrol.trackConversion.
{
  const w = newWorld([]);
  const adobeCalls = [];
  const satelliteCalls = [];
  w.win.adobeDataLayer = adobeCalls;
  w.win['adobeDataLayer.push'] = function () {};
  w.win['_satellite.track'] = (name, payload) => satelliteCalls.push({ name, payload });

  const urls = run(w, {
    dl: { event: 'ClickPatrol_Legitimate', traffic: 'safe', audience: { dhl_clean: true } },
    data: { enableAdobeDirectCall: true },
  });

  check('clickPatrolClassification is set on window',
    !!w.win.clickPatrolClassification && w.win.clickPatrolClassification.event === 'ClickPatrol_Legitimate' && w.win.clickPatrolClassification.audience.dhl_clean === true,
    JSON.stringify(w.win.clickPatrolClassification));
  check('adobeDataLayer nests traffic and audience under clickPatrol',
    adobeCalls.length === 1 && adobeCalls[0].event === 'ClickPatrol_Legitimate' && !adobeCalls[0].traffic && adobeCalls[0].clickPatrol.traffic === 'safe' && adobeCalls[0].clickPatrol.audience.dhl_clean === true,
    JSON.stringify(adobeCalls));
  check('_satellite.track fires when enableAdobeDirectCall is true',
    satelliteCalls.length === 1 && satelliteCalls[0].name === 'ClickPatrol_Legitimate' && satelliteCalls[0].payload.clickPatrol.traffic === 'safe',
    JSON.stringify(satelliteCalls));

  w.win.ClickPatrol.trackConversion({ conversion_id: 'dhl_order_1', conversion_type: 'purchase', conversion_value: 42, conversion_currency: 'EUR' });
  const c = conv(urls);
  check('window.ClickPatrol.trackConversion sends conversion',
    c.length === 1 && c[0].includes('conversion_id=dhl_order_1') && c[0].includes('conversion_type=TRANSACTION'),
    JSON.stringify(c));
}

// 9. Storage modes ("memory" and "session") + dynamic setStorageMode("full").
{
  const wMem = { win: { dataLayer: [] }, cookies: {}, ls: {}, timers: [], success: 0, failure: 0 };
  run(wMem, {
    dl: { event: 'ClickPatrol_Suspicious', traffic: 'fake' },
    data: { storageMode: 'memory', enableGclidRecovery: true, extendFacebook: true },
    params: { vd: 'vdclid' },
  });
  check('memory mode writes zero cookies and zero localStorage',
    Object.keys(wMem.cookies).length === 0 && Object.keys(wMem.ls).length === 0,
    JSON.stringify({ cookies: wMem.cookies, ls: wMem.ls }));
  check('memory mode still exposes clickPatrolClassification in memory',
    !!wMem.win.clickPatrolClassification && wMem.win.clickPatrolClassification.event === 'ClickPatrol_Suspicious',
    JSON.stringify(wMem.win.clickPatrolClassification));

  wMem.win.ClickPatrol.setStorageMode('full');
  check('setStorageMode("full") persists active IDs and classification after consent',
    !!wMem.cookies.cp_visitor_id && !!wMem.cookies.cp_session_id && !!wMem.cookies.cp_class && !!wMem.ls.cp_class,
    JSON.stringify({ cookies: wMem.cookies, ls: wMem.ls }));

  const wSess = { win: { dataLayer: [] }, cookies: {}, ls: {}, timers: [], success: 0, failure: 0 };
  run(wSess, {
    dl: { event: 'gtm.js' },
    data: { storageMode: 'session' },
  });
  check('session mode caps cp_visitor_id cookie TTL to 24h and skips localStorage',
    wSess.cookieOpts && wSess.cookieOpts.cp_visitor_id && wSess.cookieOpts.cp_visitor_id['max-age'] === 86400 && Object.keys(wSess.ls).length === 0,
    JSON.stringify({ cookieOpts: wSess.cookieOpts, ls: wSess.ls }));

  const wFull = newWorld([]);
  run(wFull, { dl: { event: 'gtm.js' } });
  check('full mode keeps the 400 day visitor cookie',
    wFull.cookieOpts && wFull.cookieOpts.cp_visitor_id && wFull.cookieOpts.cp_visitor_id['max-age'] === 400 * 24 * 60 * 60,
    JSON.stringify(wFull.cookieOpts));

  const wSessAds = { win: { dataLayer: [] }, cookies: { _gcl_aw: 'GCL.1.keep' }, ls: {}, timers: [], success: 0, failure: 0 };
  run(wSessAds, {
    dl: { event: 'gtm.js' },
    data: { storageMode: 'session', extendGoogleAds: true },
  });
  check('session mode keeps the 90 day lifetime on _gcl_aw',
    wSessAds.cookieOpts && wSessAds.cookieOpts.cp_visitor_id['max-age'] === 86400 && wSessAds.cookieOpts._gcl_aw['max-age'] === 90 * 24 * 60 * 60,
    JSON.stringify(wSessAds.cookieOpts));

  const wMemClick = {
    win: { dataLayer: [] },
    cookies: { _gcl_aw: 'GCL.123.cookieclid', cp_visitor_id: 'cp_stale_visitor' },
    ls: {},
    timers: [],
    success: 0,
    failure: 0,
  };
  const memUrls = run(wMemClick, {
    dl: { event: 'ClickPatrol_Conversion', conversion_id: 'order_mem', conversion_type: 'purchase' },
    data: { storageMode: 'memory' },
  });
  const memConv = conv(memUrls)[0] || '';
  check('memory mode still reads gclid from _gcl_aw and writes no cookies',
    memConv.includes('gclid=cookieclid') && wMemClick.cookies.cp_visitor_id === 'cp_stale_visitor' && !wMemClick.cookies.cp_session_id && Object.keys(wMemClick.ls).length === 0,
    JSON.stringify({ url: memConv, cookies: wMemClick.cookies }));

  const wDrop = newWorld([]);
  wDrop.cookies._gcl_aw = 'GCL.1.keep';
  run(wDrop, { dl: { event: 'ClickPatrol_Suspicious', traffic: 'fake' } });
  wDrop.win.ClickPatrol.trackConversion({ conversion_id: 'order_w', conversion_type: 'lead' });
  wDrop.win.ClickPatrol.setStorageMode('memory');
  check('setStorageMode memory deletes ClickPatrol cookies and localStorage',
    !wDrop.cookies.cp_visitor_id && !wDrop.cookies.cp_session_id && !wDrop.cookies.cp_class && !wDrop.ls.cp_visitor_id && !wDrop.ls.cp_class && !wDrop.ls.cp_conv && wDrop.cookies._gcl_aw === 'GCL.1.keep',
    JSON.stringify({ cookies: wDrop.cookies, ls: wDrop.ls }));
  check('ClickPatrol.version is set', wDrop.win.ClickPatrol.version === '1.1.0', wDrop.win.ClickPatrol.version);
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail && !r.pass ? '  [' + r.detail + ']' : ''));
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
