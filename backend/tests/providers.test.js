/**
 * Provider failure paths, run end to end: the real Express app on a real PostgreSQL database, with the real
 * provider classes switched on (Termii SMS, Brevo email, Paystack payments). Only the network is replaced, so
 * each provider can be made unreachable, made to refuse, or made to answer normally. The tests check what the
 * user sees AND what the database holds afterwards, so a failure never loses money or leaves half-done records.
 *
 * The provider settings must be in place before the app is imported, so this file sets them first.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.SMS_PROVIDER = 'termii';
process.env.TERMII_API_KEY = 'test-termii-key';
process.env.TERMII_SENDER_ID = 'SkillPass';
process.env.TERMII_BASE_URL = 'https://termii.provider.test';
process.env.EMAIL_PROVIDER = 'brevo';
process.env.BREVO_API_KEY = 'test-brevo-key';
process.env.EMAIL_FROM = 'SkillPass <no-reply@skillpass.test>';
process.env.PAYMENT_PROVIDER = 'paystack';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_provider_failure_paths';
process.env.PAYSTACK_BASE_URL = 'https://paystack.provider.test';

// ---- the fake network -------------------------------------------------------------------------------------------
// Each provider is 'ok', 'down' (connection fails) or 'refuse' (answers with an error).
const state = { termii: 'ok', brevo: 'ok', paystack: 'ok', paystackTransfers: 'ok', paystackPaid: true };
const sent = { termii: [], brevo: [], paystack: [] };
const deposits = new Map(); // reference -> amount in kobo, as Paystack would remember it
const realFetch = globalThis.fetch;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init); // the app under test
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (url.hostname === 'termii.provider.test') {
    if (state.termii === 'down') throw new TypeError('fetch failed');
    if (state.termii === 'refuse') return json(400, { message: 'Insufficient balance' });
    sent.termii.push(body);
    return json(200, { message_id: `m${sent.termii.length}`, message: 'Successfully Sent' });
  }
  if (url.hostname === 'api.brevo.com') {
    if (state.brevo === 'down') throw new TypeError('fetch failed');
    if (state.brevo === 'refuse') return json(401, { code: 'unauthorized', message: 'Key not found' });
    sent.brevo.push(body);
    return json(201, { messageId: `<b${sent.brevo.length}@brevo>` });
  }
  if (url.hostname === 'paystack.provider.test') {
    sent.paystack.push(`${init.method ?? 'GET'} ${url.pathname}`);
    const transfer = url.pathname === '/transferrecipient' || url.pathname === '/transfer';
    const mode = transfer ? state.paystackTransfers : state.paystack;
    if (mode === 'down') throw new TypeError('fetch failed');
    if (mode === 'refuse') return json(400, { status: false, message: transfer ? 'You cannot initiate third party payouts as a starter business' : 'Invalid key' });
    if (url.pathname === '/transaction/initialize') {
      deposits.set(body.reference, body.amount);
      return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference } });
    }
    if (url.pathname.startsWith('/transaction/verify/')) {
      const ref = decodeURIComponent(url.pathname.split('/').pop());
      return json(200, { status: true, data: { status: state.paystackPaid ? 'success' : 'abandoned', amount: deposits.get(ref) ?? 0, reference: ref } });
    }
    if (url.pathname === '/transferrecipient') return json(200, { status: true, data: { recipient_code: 'RCP_test' } });
    if (url.pathname === '/transfer') return json(200, { status: true, data: { status: 'success' } });
    return json(404, { status: false, message: 'Not found' });
  }
  throw new Error(`Unexpected network call in a test: ${url}`);
};

const { api, login, pool, start, stop } = await import('./helpers.js');
const { deliverPending } = await import('../src/lib/deliveries.js');

const t = {};
const today = (days = 0) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const payments = async (agreementId) => (await pool.query('SELECT kind, amount, status FROM payments WHERE agreement_id = $1 ORDER BY created_at, kind', [agreementId])).rows;
const agreementStatus = async (id) => (await pool.query('SELECT status FROM job_agreements WHERE id = $1', [id])).rows[0].status;

before(async () => {
  await start();
  t.employer = await login('folake@skillpass.ng');
  t.artisan = await login('tobi@skillpass.ng');
  t.admin = await login('admin@skillpass.ng');
});
after(async () => {
  globalThis.fetch = realFetch;
  await stop();
});

// ---------------------------------------------------------------------------------------------------- SMS (Termii)

describe('SMS provider (Termii) failures', () => {
  before(async () => {
    const r = await api('POST', '/api/auth/register', { body: {
      role: 'employer', name: 'Kemi Interiors', email: 'kemi.provider@example.com', phone: '0803 555 7101', password: 'a-good-password',
      dob: '1988-03-04', trade: 'electrical', company: 'Kemi Interiors', consent: true, acceptTerms: true, location: { name: 'Lekki', lat: 6.45, lng: 3.47 },
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    t.newUser = r.body.token;
    t.newUserId = r.body.user.id;
  });

  it('answers 502 with a plain message when Termii cannot be reached, and leaves the phone unverified', async () => {
    state.termii = 'down';
    const r = await api('POST', '/api/auth/phone/send', { token: t.newUser });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'The message service could not be reached. Please try again.');
    assert.equal(r.body.devCode, undefined); // a real provider is configured, so the code is never shown on screen
    const u = (await pool.query('SELECT phone_verified_at FROM users WHERE id = $1', [t.newUserId])).rows[0];
    assert.equal(u.phone_verified_at, null);
  });

  it('answers 502 without revealing Termii\'s own error text when Termii refuses', async () => {
    state.termii = 'refuse';
    await pool.query("DELETE FROM contact_verifications WHERE user_id = $1", [t.newUserId]); // skip the resend wait
    const r = await api('POST', '/api/auth/phone/send', { token: t.newUser });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'The message could not be sent. Please try again in a moment.');
    assert.doesNotMatch(JSON.stringify(r.body), /Insufficient balance/);
  });

  it('sends the code once Termii is back, to the number without "+"', async () => {
    state.termii = 'ok';
    await pool.query("DELETE FROM contact_verifications WHERE user_id = $1", [t.newUserId]);
    const r = await api('POST', '/api/auth/phone/send', { token: t.newUser });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const last = sent.termii.at(-1);
    assert.equal(last.to, '2348035557101');
    assert.match(last.sms, /Your SkillPass code is \d{6}/);
  });

  it('keeps queued job alerts when Termii is down, then sends them on the next run', async () => {
    await pool.query("UPDATE users SET phone_verified_at = now() WHERE id = 'a1'");
    await pool.query(`INSERT INTO notifications (id, user_id, channel, title, body) VALUES ('n-provider-sms', 'a1', 'sms', 'New job near you', 'Fit sockets in Ajah')`);
    state.termii = 'down';
    assert.equal(await deliverPending(pool), 0);
    assert.equal((await pool.query("SELECT delivered_at FROM notifications WHERE id = 'n-provider-sms'")).rows[0].delivered_at, null);
    state.termii = 'ok';
    assert.ok(await deliverPending(pool) >= 1);
    assert.notEqual((await pool.query("SELECT delivered_at FROM notifications WHERE id = 'n-provider-sms'")).rows[0].delivered_at, null);
    assert.ok(sent.termii.some((m) => m.sms.includes('New job near you')));
  });
});

// --------------------------------------------------------------------------------------------------- email (Brevo)

describe('Email provider (Brevo) failures', () => {
  it('gives the same answer for a real and an unknown email when Brevo is down, so accounts cannot be discovered', async () => {
    state.brevo = 'down';
    const real = await api('POST', '/api/auth/password/forgot', { body: { email: 'folake@skillpass.ng' } });
    const unknown = await api('POST', '/api/auth/password/forgot', { body: { email: 'nobody-here@example.com' } });
    assert.equal(real.status, 200);
    assert.deepEqual(real.body, unknown.body);
    const logged = (await pool.query("SELECT detail FROM audit_log WHERE action = 'email.delivery_failed' ORDER BY at DESC LIMIT 1")).rows[0];
    assert.match(logged.detail, /could not be delivered/);
  });

  it('gives the same answer when Brevo refuses the key', async () => {
    state.brevo = 'refuse';
    await pool.query("DELETE FROM contact_verifications WHERE user_id = 'e2'");
    const real = await api('POST', '/api/auth/password/forgot', { body: { email: 'adaeze@skillpass.ng' } });
    assert.equal(real.status, 200);
    assert.equal(real.body.message, 'If that email belongs to a SkillPass account, a reset link is on its way.');
  });

  it('sends the reset link once Brevo is back, and the link works', async () => {
    state.brevo = 'ok';
    await pool.query("DELETE FROM contact_verifications WHERE user_id = 'e2'");
    assert.equal((await api('POST', '/api/auth/password/forgot', { body: { email: 'adaeze@skillpass.ng' } })).status, 200);
    const mail = sent.brevo.at(-1);
    assert.equal(mail.to[0].email, 'adaeze@skillpass.ng');
    const token = mail.textContent.match(/token=([0-9a-f]{48})/)[1];
    const reset = await api('POST', '/api/auth/password/reset', { body: { token, password: 'a-new-password-1' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.ok(await login('adaeze@skillpass.ng', 'a-new-password-1'));
  });
});

// ------------------------------------------------------------------------------------------------ payments (Paystack)

describe('Payment provider (Paystack) failures', () => {
  before(async () => {
    const job = await api('POST', '/api/jobs', { token: t.employer, body: {
      title: 'Rewire the shop front', skillIds: ['el-01'], location: { name: 'Ajah', lat: 6.4698, lng: 3.5852 },
      materialsBy: 'artisan', materialsBudget: 20000, workmanshipBudget: 40000,
    } });
    assert.equal(job.status, 201, JSON.stringify(job.body));
    const ref = await api('POST', `/api/jobs/${job.body.job.id}/referrals`, { token: t.employer, body: { apprenticeId: 'a1' } });
    assert.equal(ref.status, 201, JSON.stringify(ref.body));
    const quote = await api('PATCH', `/api/referrals/${ref.body.referral.id}`, { token: t.artisan, body: { status: 'accepted', quote: { workmanship: 40000, materials: 20000, availableFrom: today(1) } } });
    assert.equal(quote.status, 200, JSON.stringify(quote.body));
    const offer = await api('POST', '/api/agreements', { token: t.employer, body: {
      referralId: ref.body.referral.id, materialsAmount: 20000, workmanshipAmount: 40000, startDate: today(1), scope: 'Rewire the shop front with new sockets.', acceptTerms: true,
    } });
    assert.equal(offer.status, 201, JSON.stringify(offer.body));
    t.ag = offer.body.id;
    const accept = await api('POST', `/api/agreements/${t.ag}/accept`, { token: t.artisan, body: { acceptTerms: true } });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
  });

  it('answers 502 when Paystack cannot be reached at checkout, and records no money', async () => {
    state.paystack = 'down';
    const r = await api('POST', `/api/agreements/${t.ag}/checkout`, { token: t.employer });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'Paystack could not be reached. Please try again.');
    assert.equal(await agreementStatus(t.ag), 'accepted');
    assert.deepEqual(await payments(t.ag), []);
  });

  it('passes Paystack\'s reason on when it refuses, and still records no money', async () => {
    state.paystack = 'refuse';
    const r = await api('POST', `/api/agreements/${t.ag}/checkout`, { token: t.employer });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'Paystack: Invalid key');
    assert.deepEqual(await payments(t.ag), []);
  });

  it('does not mark a job paid when Paystack says the payment was abandoned', async () => {
    state.paystack = 'ok';
    state.paystackPaid = false;
    const c = await api('POST', `/api/agreements/${t.ag}/checkout`, { token: t.employer });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.provider, 'paystack');
    assert.equal(c.body.testMode, true);
    assert.equal(c.body.amount, 60000);
    t.ref = c.body.reference;
    const confirm = await api('POST', `/api/payments/${encodeURIComponent(t.ref)}/confirm`, { token: t.employer });
    assert.equal(confirm.status, 402);
    assert.equal(await agreementStatus(t.ag), 'accepted');
    assert.deepEqual(await payments(t.ag), []);
  });

  it('answers 502 if Paystack goes down while checking a payment, and records nothing', async () => {
    state.paystack = 'down';
    const confirm = await api('POST', `/api/payments/${encodeURIComponent(t.ref)}/confirm`, { token: t.employer });
    assert.equal(confirm.status, 502);
    assert.deepEqual(await payments(t.ag), []);
  });

  it('keeps the deposit and marks the materials payout failed when transfers are refused, and tells the administrators', async () => {
    state.paystack = 'ok';
    state.paystackPaid = true;
    state.paystackTransfers = 'refuse';
    const confirm = await api('POST', `/api/payments/${encodeURIComponent(t.ref)}/confirm`, { token: t.employer });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.deepEqual(await payments(t.ag), [
      { kind: 'deposit', amount: 60000, status: 'succeeded' },
      { kind: 'materials_payout', amount: 20000, status: 'failed' },
    ]);
    assert.equal(await agreementStatus(t.ag), 'in_progress'); // the job goes ahead; the workmanship stays held
    const n = (await api('GET', '/api/notifications', { token: t.admin })).body.notifications;
    assert.ok(n.some((x) => x.title === 'Payment failed' && x.body.includes('materials payout')));
  });

  it('records the deposit only once when the same confirmation arrives again', async () => {
    state.paystackTransfers = 'ok';
    const again = await api('POST', `/api/payments/${encodeURIComponent(t.ref)}/confirm`, { token: t.employer });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const deposits = (await payments(t.ag)).filter((p) => p.kind === 'deposit');
    assert.equal(deposits.length, 1);
  });

  it('refuses a webhook with a missing or wrong signature', async () => {
    const body = { event: 'charge.success', data: { reference: t.ref } };
    assert.equal((await api('POST', '/api/payments/paystack/webhook', { body })).status, 401);
  });
});
