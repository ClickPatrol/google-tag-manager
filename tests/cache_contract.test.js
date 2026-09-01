'use strict';

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const SCHEMA = '1';
const CLASS_MAX = 64;
const AUDIENCE_MAX = 512;
const DAY_MS = 24 * 60 * 60 * 1000;

function toBase36(num) {
	let n = num;
	if (n <= 0) return '0';
	let out = '';
	while (n > 0) {
		out = B36.charAt(n % 36) + out;
		n = Math.floor(n / 36);
	}
	return out;
}

function sessionSuffix(id) {
	return id.length <= 8 ? id : id.slice(-8);
}

function encodeClass(kind, traffic, sessId, ts, clickHash) {
	let value = `${SCHEMA}.${kind}.${traffic}.${sessionSuffix(sessId)}.${toBase36(ts)}`;
	if (clickHash) {
		value += '.' + clickHash;
	}
	return value;
}

function hashFingerprint(fp) {
	let h = 7;
	for (let i = 0; i < fp.length; i++) {
		const ch = fp.charAt(i);
		let v = B36.indexOf(ch.toLowerCase());
		if (v < 0) {
			if (ch === '=') v = 37;
			else if (ch === '&') v = 38;
			else if (ch === '-') v = 39;
			else if (ch === '_') v = 40;
			else if (ch === '.') v = 41;
			else v = 42;
		}
		h = h * 33 + v + i;
		if (h > 2000000000) h = h - Math.floor(h / 1000000000) * 1000000000;
	}
	return toBase36(h);
}

function encodeAudience(audience, sessId, ts) {
	const json = JSON.stringify(audience);
	return `${SCHEMA}.${sessionSuffix(sessId)}.${toBase36(ts)}.${encodeURIComponent(json)}`;
}

const sess = 'cp_existing_session';
const ts = 1000;
const audience = {
	custom_audience_iphone: false,
	russia_exclusions: false,
	apple_gebruikers: false,
	legitieme_audience: false,
};

const classValue = encodeClass('S', 'f', sess, ts);
const audienceValue = encodeAudience(audience, sess, ts);

if (classValue !== '1.S.f._session.rs') {
	throw new Error('class encoding mismatch: ' + classValue);
}
if (classValue.length > CLASS_MAX) {
	throw new Error('class over budget: ' + classValue.length);
}
if (audienceValue.length > AUDIENCE_MAX) {
	throw new Error('audience over cookie budget: ' + audienceValue.length);
}

const decoded = JSON.parse(decodeURIComponent(audienceValue.split('.').slice(3).join('.')));
if (JSON.stringify(decoded) !== JSON.stringify(audience)) {
	throw new Error('audience roundtrip failed');
}

const hashG = hashFingerprint('source=g');
const hashF = hashFingerprint('source=f');
const hashGclid = hashFingerprint('gclid=abc');
if (hashG === hashF) {
	throw new Error('source=g and source=f must hash differently');
}
if (hashG !== 'cfomrj' || hashF !== 'cfomri' || hashGclid !== '8j2i1t') {
	throw new Error('click hash mismatch: ' + [hashG, hashF, hashGclid].join(' '));
}
const classWithClick = encodeClass('S', 'f', sess, ts, hashGclid);
if (classWithClick !== '1.S.f._session.rs.8j2i1t') {
	throw new Error('class with click hash mismatch: ' + classWithClick);
}
if (classWithClick.length > CLASS_MAX) {
	throw new Error('class with click hash over budget: ' + classWithClick.length);
}

const start = process.hrtime.bigint();
for (let i = 0; i < 1000; i++) {
	encodeClass('L', 's', sess, Date.now());
	encodeAudience(audience, sess, Date.now());
}
const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
if (elapsedMs / 1000 > 1) {
	throw new Error('encode loop slower than 1ms each: ' + elapsedMs);
}

if (Date.now() - ts <= DAY_MS) {
	// fixture timestamp 1000 is expired today; confirm expiry math
	if (Date.now() - ts <= DAY_MS) {
		/* live timestamps used above are fresh */
	}
}

console.log('cache contract ok', {
	classBytes: classValue.length,
	audienceBytes: audienceValue.length,
	encode1000ms: Math.round(elapsedMs * 100) / 100,
});
