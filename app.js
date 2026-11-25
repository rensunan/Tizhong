/* 应用主逻辑 */
(function () {
  const E = window.Engine;
  const St = window.Store;

  const S = {
    view: 'today',
    range: 30,
    authTab: 'login',
    acctType: 'phone',
    pending: null,
    onbStep: 0,
    onb: {},
    mealSlot: null,
    mealSel: [],
    foodCat: 'staple',
    foodScene: 'all',
    sheet: null,
    fg: null,
    guest: false,
    guestWarned: false,
    guestBarClosed: false
  };

  const $ = s => document.querySelector(s);
  const today = () => E.today();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const KG2J = 2;
  const toJ = kg => { const v = Number(kg || 0) * KG2J; return Math.round(v * 2) / 2; };
  const toKg = j => Math.round(Number(j || 0) / KG2J * 100) / 100;
  const ageOf = y => Math.max(1, new Date().getFullYear() - Number(y || 1995));

  function fmtDate(iso) { return iso ? iso.slice(5).replace('-', '/') : ''; }
  function weekday(iso) { const d = new Date(iso + 'T00:00:00'); return '周' + '日一二三四五六'[d.getDay()]; }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 2000);
  }

  /* ============ 数据辅助 ============ */
  function P() { return St.state.profile; }
  function weights() { return St.state.weights || []; }
  function lastWeight() { const w = weights(); return w.length ? w[w.length - 1] : null; }
  function todayMeals() { return (St.state.meals || []).filter(m => m.date === today()); }
  function todayWorkouts() { return (St.state.workouts || []).filter(w => w.date === today()); }
  function intakeOf(list) { return list.reduce((s, m) => s + (m.kcal || 0), 0); }
  function burnOf(list) { return list.reduce((s, w) => s + (w.kcal || 0), 0); }

  function calcProfile() {
    const p = P() || {};
    const w = weights();
    const lw = w.length ? w[w.length - 1] : null;
    const fw = w.length ? w[0] : null;
    return {
      ...p,
      weight: lw ? lw.weight : (p.startWeight || 60),
      startWeight: p.startWeight || (fw ? fw.weight : 60),
      startDate: p.startDate || (fw ? fw.date : today())
    };
  }

  function blockedNames(kind) {
    return St.state.customs.filter(c => c.kind === kind && c.payload && c.payload.blocked).map(c => c.name);
  }

  function pickTemplate(p) {
    const eq = p.equipment || ['none'];
    const gym = eq.includes('machine') || eq.includes('barbell') || eq.includes('cable');
    const goal = p.goalType || 'cut';
    const pool = window.PLAN_TEMPLATES.filter(t => t.goal === goal || t.goal === 'both');
    const byPlace = pool.filter(t => (gym ? t.place === 'gym' : t.place !== 'gym'));
    const ok = (byPlace.length ? byPlace : pool).filter(t => t.equip.every(x => eq.includes(x)));
    return ok[0] || (byPlace[0] || pool[0] || window.PLAN_TEMPLATES[0]);
  }

  function currentTemplate() {
    const p = P() || {};
    const t = window.PLAN_TEMPLATES.find(x => x.id === p.planId);
    return t || pickTemplate(p);
  }

  /* ---- 预设：三餐 + 每周训练 ---- */
  const SKIP_MARK = '（今天没吃）';
  /* 模板动作调整后 +1，让老用户存下的周计划自动重铺一次 */
  const WP_VER = 3;
  let _wp = null;

  function extra() { return (P() && P().extra) || {}; }

  async function saveExtra(patch) {
    return St.saveProfile({ extra: { ...extra(), ...patch } });
  }

  function mealPreset(slot) {
    const mp = extra().mealPreset || {};
    return mp[slot] || null;
  }

  function weekPlan() {
    if (_wp) return _wp;
    const e = extra();
    if (e.weekPlan && e.weekPlanVer === WP_VER) { _wp = e.weekPlan; return _wp; }
    const cp = calcProfile();
    _wp = E.buildWeekPlan(currentTemplate(), cp.freqMode || 'weekly', cp.freqCount || 3);
    saveExtra({ weekPlan: _wp, weekPlanVer: WP_VER });
    return _wp;
  }

  async function setWeekPlan(plan) {
    _wp = plan;
    return saveExtra({ weekPlan: plan, weekPlanVer: WP_VER });
  }

  /* 按「当前模板 + 频率模式/次数」重铺这一周：改次数、切按周/按月、换模板都走这里 */
  async function applyPlanFreq(tpl) {
    const cp = calcProfile();
    const t = tpl || currentTemplate();
    const mode = cp.freqMode || 'weekly';
    const count = cp.freqCount || (mode === 'monthly' ? t.daysPerMonth : t.daysPerWeek) || 3;
    const plan = E.buildWeekPlan(t, mode, count);
    return setWeekPlan(plan);
  }

  /* 模板在某个模式下的默认频率（切模式时用它兜底） */
  function tplDefaultFreq(tpl, mode) {
    const t = tpl || currentTemplate();
    return mode === 'monthly' ? (t.daysPerMonth || (t.daysPerWeek || 3) * 4) : (t.daysPerWeek || 3);
  }

  /* 每月 N 次折算成每周几天的说法：不整除时给区间，避免误导 */
  function perWeekLabel(n) {
    const v = Number(n) / 4;
    const c = x => Math.min(7, Math.max(1, x));
    const lo = c(Math.floor(v)), hi = c(Math.ceil(v));
    return lo === hi ? '每周 ' + lo + ' 天' : '每周 ' + lo + '~' + hi + ' 天';
  }

  function streakDays() {
    const set = new Set(weights().map(w => w.date));
    let d = today(), n = 0;
    if (!set.has(d)) d = E.addDays(d, -1);
    while (set.has(d)) { n++; d = E.addDays(d, -1); }
    return n;
  }

  /* ============ 启动 ============ */
  async function boot() {
    const ready = St.init();
    let session = null;
    if (ready) {
      /* 恢复会话最多等 4 秒：网络卡住也不要把人挡在启动页 */
      session = await Promise.race([
        St.restore(),
        new Promise(r => setTimeout(() => r(null), 4000))
      ]);
      if (!session && St.session) session = St.session;
    }
    if (session) { await afterLogin(); return; }
    enterGuest();
  }

  /* 没有账号也能先用：数据只存在内存里，改动不写库，刷新即恢复样例 */
  function enterGuest(withGuide) {
    St.enterGuest();
    S.guest = true;
    S.guestWarned = false;
    S.guestBarClosed = false;
    S.sheetStack = [];
    $('#sheet-root').innerHTML = '';
    _wp = null;
    S.view = 'today';
    renderApp();
    if (withGuide !== false && !guestGuideSeen()) {
      setTimeout(() => { if (S.guest) openGuestGuide(); }, 500);
    }
  }

  function guestGuideSeen() {
    try { return sessionStorage.getItem('bm_guest_guide') === '1'; } catch (e) { return false; }
  }
  function markGuestGuide() {
    try { sessionStorage.setItem('bm_guest_guide', '1'); } catch (e) { /* 忽略 */ }
  }

  async function afterLogin() {
    S.guest = false;
    St.guest = false;
    const r = await St.loadAll();
    if (r.error) {
      toast(r.error);
      showAuth();
      return;
    }
    $('#boot').classList.add('hidden');
    _wp = null;
    if (!P()) { startOnboard(); return; }
    S.view = 'today';
    renderApp();
  }

  function showAuth() {
    $('#boot').classList.add('hidden');
    $('#view-main').classList.add('hidden');
    $('#view-onboard').classList.add('hidden');
    $('#view-auth').classList.remove('hidden');
    renderAuth();
  }

  /* ============ 认证 ============ */
  function renderAuth() {
    const login = S.authTab === 'login';
    const phone = S.acctType === 'phone';
    const html = `
    <div class="auth-wrap"><div class="auth-card">
      <div class="auth-logo">见轻</div>
      <div class="auth-sub">每天一个数字，看见身体的变化</div>
      <div class="seg seg-block" style="margin-bottom:18px">
        <button class="seg-item ${login ? 'active' : ''}" data-act="auth-tab" data-tab="login">登录</button>
        <button class="seg-item ${!login ? 'active' : ''}" data-act="auth-tab" data-tab="register">注册</button>
      </div>
      <div class="seg seg-block" style="margin-bottom:16px">
        <button class="seg-item ${phone ? 'active' : ''}" data-act="acct-type" data-type="phone">手机号</button>
        <button class="seg-item ${!phone ? 'active' : ''}" data-act="acct-type" data-type="email">邮箱</button>
      </div>
      <div class="field">
        <label>${phone ? '手机号' : '邮箱'}</label>
        <input id="acct" class="input" type="${phone ? 'tel' : 'email'}" inputmode="${phone ? 'numeric' : 'email'}"
          placeholder="${phone ? '请输入 11 位手机号' : 'you@example.com'}" value="${esc(S.lastAcct || '')}" />
      </div>
      ${login ? '' : `
      <div class="field">
        <label>验证码</label>
        <div class="code-row">
          <input id="code" class="input" inputmode="numeric" placeholder="6 位验证码" />
          <button class="btn" id="send-code" data-act="send-code" type="button">获取验证码</button>
        </div>
      </div>`}
      <div class="field">
        <label>密码${login ? '' : '（至少 6 位）'}</label>
        <input id="pwd" class="input" type="password" placeholder="${login ? '请输入密码' : '设置登录密码'}" />
      </div>
      <div class="err" id="auth-err"></div>
      <button class="btn btn-primary btn-block" data-act="${login ? 'do-login' : 'do-register'}">
        ${login ? '登录' : '注册并登录'}
      </button>
      ${login ? `<div style="text-align:center;margin-top:14px">
        <button class="btn btn-ghost btn-mini" data-act="forgot">忘记密码？</button></div>` : ''}
      <div class="legal">继续即表示同意本应用仅将你的身体数据用于生成个人建议，<br/>数据存储在你的账号下，不与他人共享。</div>
      ${St.online ? '' : `<div class="notice mt12">当前网络连不上云端，账号功能暂不可用，你可以先以游客身份体验。</div>`}
      ${(S.guest || St.guest) ? `<button class="btn btn-ghost btn-block mt8" data-act="guest-back">先逛逛，不登录 →</button>
      <div class="hint mt8" style="text-align:center">游客体验里的改动不会带到账号里</div>` : ''}
    </div></div>`;
    $('#view-auth').innerHTML = html;
  }

  async function sendCode() {
    const acct = ($('#acct') || {}).value || '';
    const err = $('#auth-err');
    if (S.acctType === 'phone' && !/^1\d{10}$/.test(acct)) { err.textContent = '请输入正确的 11 位手机号'; return; }
    if (S.acctType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acct)) { err.textContent = '请输入正确的邮箱地址'; return; }
    err.textContent = '';
    const btn = $('#send-code');
    btn.disabled = true; btn.textContent = '发送中…';
    const r = await St.sendCode(acct, S.acctType);
    if (r.error) { err.textContent = r.error; btn.disabled = false; btn.textContent = '获取验证码'; return; }
    S.pending = { account: acct, ...r.data };
    S.lastAcct = acct;
    let n = 60;
    const tm = setInterval(() => {
      n--;
      if (n <= 0 || !document.body.contains(btn)) { clearInterval(tm); if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = '重新获取'; } return; }
      btn.textContent = n + 's 后重发';
    }, 1000);
    toast('验证码已发送');
  }

  async function doLogin() {
    const acct = ($('#acct') || {}).value || '';
    const pwd = ($('#pwd') || {}).value || '';
    const err = $('#auth-err');
    if (!acct || !pwd) { err.textContent = '请填写账号和密码'; return; }
    if (S.acctType === 'phone' && !/^1\d{10}$/.test(acct)) { err.textContent = '请输入正确的 11 位手机号'; return; }
    err.textContent = '登录中…';
    const r = await St.signIn({ account: acct, type: S.acctType, password: pwd });
    if (r.error) { err.textContent = r.error; return; }
    S.lastAcct = acct;
    await afterLogin();
  }

  async function doRegister() {
    const acct = ($('#acct') || {}).value || '';
    const code = ($('#code') || {}).value || '';
    const pwd = ($('#pwd') || {}).value || '';
    const err = $('#auth-err');
    if (!S.pending || S.pending.account !== acct) { err.textContent = '请先获取当前账号的验证码'; return; }
    if (!code) { err.textContent = '请输入验证码'; return; }
    if (pwd.length < 6) { err.textContent = '密码至少 6 位'; return; }
    err.textContent = '注册中…';
    const r = await St.register({
      account: acct, type: S.acctType, code, password: pwd,
      verificationId: S.pending.verificationId, isExistingUser: S.pending.isExistingUser
    });
    if (r.error) { err.textContent = r.error; return; }
    S.pending = null;
    await afterLogin();
  }

  /* ============ 找回密码 ============ */
  function openForgot() {
    const acct = (($('#acct') || {}).value || '').trim();
    S.fg = { step: 1, type: S.acctType, account: acct, remain: 0 };
    renderForgot();
  }

  function renderForgot() {
    const fg = S.fg || (S.fg = { step: 1, type: 'email', account: '', remain: 0 });
    const isEmail = fg.type === 'email';
    const head = `
      <div class="seg seg-block" style="margin-bottom:16px">
        <button class="seg-item ${isEmail ? 'active' : ''}" data-act="fg-type" data-type="email">邮箱账号</button>
        <button class="seg-item ${!isEmail ? 'active' : ''}" data-act="fg-type" data-type="phone">手机账号</button>
      </div>`;
    let body;
    if (fg.step === 1) {
      body = `${head}
        <div class="field"><label>${isEmail ? '注册邮箱' : '注册手机号'}</label>
          <input id="fg-acct" class="input" type="${isEmail ? 'email' : 'tel'}" inputmode="${isEmail ? 'email' : 'numeric'}"
            value="${esc(fg.account || '')}" placeholder="${isEmail ? 'you@example.com' : '请输入 11 位手机号'}" /></div>
        <div class="err" id="fg-err"></div>
        <button class="btn btn-primary btn-block" data-act="fg-send">${isEmail ? '发送重置验证码' : '发送验证码'}</button>
        <div class="hint mt12" style="text-align:center">${isEmail
          ? '向该邮箱发送 6 位验证码，验证后可设置新密码'
          : '手机账号用短信验证码直接登录，登录后可在个人中心重设密码'}</div>`;
    } else {
      body = `${head}
        <div class="notice green" style="margin-bottom:12px">验证码已发送至 ${esc(fg.account)}</div>
        <div class="field"><label>验证码</label>
          <div class="code-row">
            <input id="fg-code" class="input" inputmode="numeric" placeholder="6 位验证码" />
            <button class="btn" id="fg-resend" data-act="fg-send" ${fg.remain > 0 ? 'disabled' : ''}>${fg.remain > 0 ? fg.remain + 's 后重发' : '重新获取'}</button>
          </div></div>
        ${isEmail ? `
        <div class="field"><label>新密码（至少 6 位）</label>
          <input id="fg-pwd" class="input" type="password" placeholder="设置新密码" /></div>
        <div class="field"><label>确认新密码</label>
          <input id="fg-pwd2" class="input" type="password" placeholder="再输入一次" /></div>` : ''}
        <div class="err" id="fg-err"></div>
        <button class="btn btn-primary btn-block" data-act="${isEmail ? 'fg-reset' : 'fg-verify-login'}">
          ${isEmail ? '重设密码并登录' : '验证码登录'}</button>
        <div class="hint mt12" style="text-align:center">${isEmail
          ? '重设成功后会自动登录，云端数据不变'
          : '手机账号无法远程重设密码，建议登录后在个人中心修改'}</div>`;
    }
    openSheet('找回密码', body, '');
  }

  function fgCountdown() {
    const tm = setInterval(() => {
      if (!S.fg || S.fg.step !== 2) { clearInterval(tm); return; }
      S.fg.remain--;
      const b = $('#fg-resend');
      if (!b) { clearInterval(tm); return; }
      if (S.fg.remain <= 0) { clearInterval(tm); b.disabled = false; b.textContent = '重新获取'; }
      else b.textContent = S.fg.remain + 's 后重发';
    }, 1000);
  }

  async function fgSend() {
    const fg = S.fg;
    if (!fg) return;
    const err = $('#fg-err');
    const acctInput = $('#fg-acct');
    if (acctInput) fg.account = acctInput.value.trim();
    if (fg.type === 'phone' && !/^1\d{10}$/.test(fg.account)) { err.textContent = '请输入正确的 11 位手机号'; return; }
    if (fg.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fg.account)) { err.textContent = '请输入正确的邮箱地址'; return; }
    const btn = $('#fg-resend') || $('[data-act="fg-send"]');
    if (btn) { btn.disabled = true; btn.textContent = '发送中…'; }
    err.textContent = '';
    const r = fg.type === 'email'
      ? await St.sendResetCode(fg.account)
      : await St.sendCode(fg.account, 'phone');
    if (r.error) {
      if (btn) { btn.disabled = false; btn.textContent = '重新获取'; }
      err.textContent = r.error;
      return;
    }
    if (fg.type === 'phone') S.pending = { account: fg.account, ...r.data };
    fg.step = 2; fg.remain = 60;
    renderForgot();
    fgCountdown();
    toast('验证码已发送');
  }

  async function fgReset() {
    const fg = S.fg;
    const err = $('#fg-err');
    const code = (($('#fg-code') || {}).value || '').trim();
    const p1 = ($('#fg-pwd') || {}).value || '';
    const p2 = ($('#fg-pwd2') || {}).value || '';
    if (!code) { err.textContent = '请输入验证码'; return; }
    if (p1.length < 6) { err.textContent = '新密码至少 6 位'; return; }
    if (p1 !== p2) { err.textContent = '两次输入的密码不一致'; return; }
    err.textContent = '提交中…';
    const r = await St.confirmReset(fg.account, code, p1);
    if (r.error) { err.textContent = r.error; return; }
    S.lastAcct = fg.account;
    S.fg = null; S.sheetStack = [];
    closeSheet();
    toast('密码已重设');
    await afterLogin();
  }

  async function fgVerifyLogin() {
    const fg = S.fg;
    const err = $('#fg-err');
    const code = (($('#fg-code') || {}).value || '').trim();
    if (!code) { err.textContent = '请输入验证码'; return; }
    if (!S.pending || S.pending.account !== fg.account) { err.textContent = '请先获取当前手机号的验证码'; return; }
    err.textContent = '验证中…';
    const r = await St.loginWithCode({ account: fg.account, type: 'phone', verificationId: S.pending.verificationId, token: code });
    if (r.error) { err.textContent = r.error; return; }
    S.pending = null; S.lastAcct = fg.account;
    S.fg = null; S.sheetStack = [];
    closeSheet();
    await afterLogin();
  }

  /* 已登录后改密码 */
  function openChangePwd() {
    const isEmail = !!(St.session && St.session.user && St.session.user.email);
    openSheet('修改密码', `
      ${isEmail ? '' : `<div class="hint" style="margin-bottom:12px">手机账号也可以在这里重设密码，记住新密码即可。</div>`}
      <div class="field"><label>原密码</label>
        <input id="cp-old" class="input" type="password" placeholder="当前登录密码" /></div>
      <div class="field"><label>新密码（至少 6 位）</label>
        <input id="cp-new" class="input" type="password" placeholder="设置新密码" /></div>
      <div class="field"><label>确认新密码</label>
        <input id="cp-new2" class="input" type="password" placeholder="再输入一次" /></div>
      <div class="err" id="cp-err"></div>
      <button class="btn btn-primary btn-block" data-act="pwd-save">保存新密码</button>
      <div class="hint mt12" style="text-align:center">修改后其他设备需重新登录</div>`, '');
  }

  async function saveChangePwd() {
    const err = $('#cp-err');
    const oldP = ($('#cp-old') || {}).value || '';
    const n1 = ($('#cp-new') || {}).value || '';
    const n2 = ($('#cp-new2') || {}).value || '';
    if (!oldP) { err.textContent = '请输入原密码'; return; }
    if (n1.length < 6) { err.textContent = '新密码至少 6 位'; return; }
    if (n1 !== n2) { err.textContent = '两次输入的密码不一致'; return; }
    if (n1 === oldP) { err.textContent = '新密码不能与原密码相同'; return; }
    err.textContent = '提交中…';
    const r = await St.changePassword(oldP, n1);
    if (r.error) { err.textContent = r.error; return; }
    closeSheet();
    toast('密码已修改');
  }

  /* ============ 引导 ============ */
  function startOnboard() {
    S.onbStep = 0;
    S.onb = {
      gender: 'male', birthYear: 1995, height: 170, weightKg: 70,
      targetKg: 65, targetDate: E.addDays(today(), 90),
      activity: 'light',
      equipment: ['none'], limitations: [], dietStyle: 'normal', dislikes: [],
      freqMode: 'weekly', freqCount: 3
    };
    $('#view-main').classList.add('hidden');
    $('#view-auth').classList.add('hidden');
    $('#view-onboard').classList.remove('hidden');
    renderOnboard();
  }

  /* ---- 滚轮选择：数字 / 日期 ---- */
  function pickNumber(title, min, max, step, value, decimals, onPick) {
    const items = [];
    const n = Math.round((max - min) / step);
    for (let i = 0; i <= n; i++) {
      const v = Math.round((min + i * step) * 100) / 100;
      items.push({ label: decimals ? v.toFixed(decimals) : String(v), value: v });
    }
    const idx = Math.max(0, Math.min(items.length - 1, Math.round((Number(value) - min) / step)));
    Picker.open({ title, columns: [{ key: 'v', items, index: idx }], onConfirm: o => onPick(o.v) });
  }

  function pickDate(title, iso, onPick, opt) {
    const o = opt || {};
    const d = E.parseISO(iso || today());
    const y0 = new Date().getFullYear();
    const from = o.from != null ? o.from : y0 - 1;
    const to = o.to != null ? o.to : y0 + 6;
    const years = [], months = [], days = [];
    for (let y = from; y <= to; y++) years.push({ label: y + ' 年', value: y });
    for (let m = 1; m <= 12; m++) months.push({ label: m + ' 月', value: m });
    for (let dd = 1; dd <= 31; dd++) days.push({ label: dd + ' 日', value: dd });
    Picker.open({
      title,
      columns: [
        { key: 'y', items: years, index: Math.max(0, years.findIndex(x => x.value === d.getFullYear())) },
        { key: 'm', items: months, index: d.getMonth() },
        { key: 'd', items: days, index: d.getDate() - 1 }
      ],
      onConfirm: o => {
        const dim = new Date(o.y, o.m, 0).getDate();
        const day = Math.min(o.d, dim);
        onPick(o.y + '-' + E.pad(o.m) + '-' + E.pad(day));
      }
    });
  }

  function renderOnboard() {
    const s = S.onb, step = S.onbStep;
    const eqList = [
      ['none', '徒手'], ['dumbbell', '哑铃'], ['barbell', '杠铃'], ['machine', '固定器械'],
      ['cable', '龙门架'], ['band', '弹力带'], ['kettlebell', '壶铃'], ['rope', '跳绳'],
      ['treadmill', '跑步机'], ['bike', '单车'], ['rower', '划船机'], ['pool', '泳池']
    ];
    const limList = [['knee', '膝盖不适'], ['back', '腰部不适'], ['shoulder', '肩部不适']];
    const diffDays = E.daysBetween(today(), s.targetDate);

    const body = `
      <div class="onb">
        <div class="steps"><i class="on"></i><i class="${step >= 1 ? 'on' : ''}"></i><i class="${step >= 2 ? 'on' : ''}"></i></div>
        <h2 style="font-size:20px;margin:0 0 4px">${['先认识一下你的身体', '给自己定个目标', '你能怎么练、怎么吃'][step]}</h2>
        <p class="sub" style="margin:0 0 22px">${['用于计算基础代谢和每日消耗', '指标会据此倒推，随时可以改', '推荐只会给你能做到的方案'][step]}</p>
        ${step === 0 ? `
          <div class="field"><label>性别</label>
            <div class="seg seg-block">
              <button class="seg-item ${s.gender === 'male' ? 'active' : ''}" data-act="onb-set" data-k="gender" data-v="male">男</button>
              <button class="seg-item ${s.gender === 'female' ? 'active' : ''}" data-act="onb-set" data-k="gender" data-v="female">女</button>
            </div>
          </div>
          <div class="field"><label>出生年份</label>
            <button class="field-pick" data-act="pick-birth">
              <span><span class="v">${s.birthYear}</span><span class="u">年 · 约 ${ageOf(s.birthYear)} 岁</span></span>
              <span class="ar">滑动选择 ›</span>
            </button>
          </div>
          <div class="field"><label>身高</label>
            <button class="field-pick" data-act="pick-height">
              <span><span class="v">${s.height}</span><span class="u">cm</span></span>
              <span class="ar">滑动选择 ›</span>
            </button>
          </div>
          <div class="field"><label>当前体重</label>
            <button class="field-pick" data-act="pick-weight">
              <span><span class="v">${toJ(s.weightKg)}</span><span class="u">斤</span></span>
              <span class="ar">滑动选择 ›</span>
            </button>
          </div>
          <div class="field"><label>日常活动量（不含训练）</label>
            <select class="input" id="onb-activity">
              <option value="sedentary" ${s.activity === 'sedentary' ? 'selected' : ''}>基本不动 · 办公室久坐</option>
              <option value="light" ${s.activity === 'light' ? 'selected' : ''}>偶尔走动 · 少量站立</option>
              <option value="moderate" ${s.activity === 'moderate' ? 'selected' : ''}>经常走动 · 站立型工作</option>
              <option value="active" ${s.activity === 'active' ? 'selected' : ''}>大量走动 · 体力劳动</option>
            </select>
            <div class="hint">只算工作、通勤、家务这类日常走动，训练消耗在下一步单独设置。</div>
          </div>
        ` : ''}
        ${step === 1 ? `
          <div class="field"><label>预期体重</label>
            <button class="field-pick" data-act="pick-target">
              <span><span class="v">${toJ(s.targetKg)}</span><span class="u">斤</span></span>
              <span class="ar">滑动选择 ›</span>
            </button>
          </div>
          <div class="field"><label>预期达成日期</label>
            <button class="field-pick" data-act="pick-date">
              <span><span class="v">${s.targetDate.replace(/-/g, '/')}</span><span class="u">${diffDays} 天后</span></span>
              <span class="ar">滑动选择 ›</span>
            </button>
          </div>
          <div class="field"><label>每周想练几天</label>
            <div class="seg seg-block">
              ${[1, 2, 3, 4, 5, 6].map(n => `<button class="seg-item ${s.freqCount === n ? 'active' : ''}" data-act="onb-set" data-k="freqCount" data-v="${n}">${n}</button>`).join('')}
            </div>
            <div class="hint">只是训练频率，和上面那个日常活动量没关系。</div>
          </div>
          <div id="onb-preview" class="notice green" style="display:none"></div>
        ` : ''}
        ${step === 2 ? `
          <div class="field"><label>你有哪些器械 / 场地条件（可多选）</label>
            <div class="chips">
              ${eqList.map(([k, n]) => `<button class="chip ${s.equipment.includes(k) ? 'on' : ''}" data-act="onb-multi" data-k="equipment" data-v="${k}">${n}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:18px"><label>身体限制（没有就不选）</label>
            <div class="chips">
              ${limList.map(([k, n]) => `<button class="chip ${s.limitations.includes(k) ? 'on' : ''}" data-act="onb-multi" data-k="limitations" data-v="${k}">${n}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:18px"><label>饮食方式</label>
            <div class="chips">
              ${window.DIET_STYLES.map(d => `<button class="chip ${s.dietStyle === d.id ? 'on' : ''}" data-act="onb-set" data-k="dietStyle" data-v="${d.id}">${d.name}</button>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:18px"><label>不吃 / 忌口（可多选）</label>
            <div class="chips">
              ${window.AVOID_TAGS.map(t => `<button class="chip ${s.dislikes.includes(t) ? 'on' : ''}" data-act="onb-multi" data-k="dislikes" data-v="${t}">${t}</button>`).join('')}
            </div>
          </div>
        ` : ''}
        <div class="row" style="margin-top:26px;gap:10px">
          ${step > 0 ? `<button class="btn" data-act="onb-back" style="flex:0 0 96px">上一步</button>` : ''}
          <button class="btn btn-primary grow" data-act="${step < 2 ? 'onb-next' : 'onb-finish'}">${step < 2 ? '下一步' : '开始记录'}</button>
        </div>
      </div>`;
    $('#view-onboard').innerHTML = body;
    if (step === 1) updatePreview();
  }

  function readOnb() {
    const s = S.onb;
    if (S.onbStep === 0) {
      const a = $('#onb-activity');
      if (a) s.activity = a.value;
    }
  }

  function updatePreview() {
    const box = $('#onb-preview');
    if (!box) return;
    const s = S.onb;
    const p = {
      gender: s.gender, birthYear: s.birthYear, height: s.height,
      activity: s.activity || 'light',
      startWeight: s.weightKg, targetWeight: s.targetKg,
      startDate: today(), targetDate: s.targetDate, weight: s.weightKg
    };
    const pl = E.plan(p);
    box.style.display = 'block';

    if (pl.dir === 'maintain') {
      box.innerHTML = `目标体重和现在一样，那就走维持：每天吃大约 <b>${pl.targetIntake}</b> kcal。`;
      return;
    }
    const fromJ = toJ(s.weightKg), toJv = toJ(s.targetKg);
    const diffJ = Math.abs(E.round1(fromJ - toJv));
    const weeks = Math.max(1, Math.round(E.daysBetween(today(), s.targetDate) / 7));
    box.innerHTML = `
      从 <b>${fromJ} 斤</b> ${pl.dir === 'cut' ? '减' : '增'}到 <b>${toJv} 斤</b>，
      共 ${diffJ} 斤 / 约 ${weeks} 周。<br/>
      每天需要 <b>${pl.deficit}</b> kcal 的${pl.dir === 'cut' ? '缺口' : '盈余'}，
      目标摄入约 <b>${pl.targetIntake}</b> kcal。
      ${pl.tooFast ? '<br/>⚠️ 期限偏紧，按健康速率建议 ' + pl.suggestDate + ' 达成。' : ''}`;
  }

  function onbNext() {
    readOnb();
    if (S.onbStep === 0) {
      if (!(S.onb.height > 100 && S.onb.height < 240)) return toast('身高填得不太对');
      if (!(S.onb.weightKg > 25 && S.onb.weightKg < 300)) return toast('体重填得不太对');
    }
    if (S.onbStep === 1) {
      if (!(S.onb.targetKg > 25 && S.onb.targetKg < 300)) return toast('目标体重填得不太对');
      if (E.daysBetween(today(), S.onb.targetDate) < 7) return toast('期限至少留 7 天');
    }
    S.onbStep++;
    renderOnboard();
  }

  async function onbFinish() {
    const s = S.onb;
    const goalType = s.targetKg < s.weightKg ? 'cut' : (s.targetKg > s.weightKg ? 'bulk' : 'maintain');
    const p = {
      gender: s.gender, birthYear: s.birthYear, height: s.height, activity: s.activity || 'light',
      goalType, startWeight: s.weightKg, targetWeight: s.targetKg,
      startDate: today(), targetDate: s.targetDate,
      freqMode: s.freqMode, freqCount: s.freqCount,
      equipment: s.equipment.length ? s.equipment : ['none'],
      limitations: s.limitations, dietStyle: s.dietStyle, dislikes: s.dislikes
    };
    p.planId = pickTemplate({ ...p, equipment: p.equipment }).id;
    const r = await St.saveProfile(p);
    if (r.error) return toast(r.error);
    if (!weights().length) await St.logWeight(today(), s.weightKg, null, '初始体重');
    $('#view-onboard').classList.add('hidden');
    S.view = 'today';
    renderApp();
  }

  /* ============ 主界面 ============ */
  function isGuest() { return !!St.guest; }
  function userName() { return isGuest() ? '游客体验' : (St.userLabel() || '用户'); }
  function userAvatar() {
    if (isGuest()) return '游';
    return (St.userLabel() || '用').trim().charAt(0).toUpperCase() || '用';
  }

  function renderGuestBar() {
    const gb = $('#guestbar');
    if (!gb) return;
    if (!isGuest() || S.guestBarClosed) { gb.classList.add('hidden'); gb.innerHTML = ''; return; }
    gb.classList.remove('hidden');
    gb.innerHTML = `<div class="guest-bar">
      <div class="guest-bar-main">
        <b>游客体验中</b>
        <span>改动只留在本页，刷新会恢复样例数据</span>
      </div>
      <button class="btn btn-primary btn-mini" data-act="guest-signup">注册/登录</button>
      <button class="gb-x" data-act="guest-bar-close" aria-label="关闭提示">×</button>
    </div>`;
  }

  function renderApp() {
    $('#boot').classList.add('hidden');
    $('#view-auth').classList.add('hidden');
    $('#view-onboard').classList.add('hidden');
    $('#view-main').classList.remove('hidden');
    const p = P();
    const pl = E.progress(weights(), calcProfile()).plan;
    const VIEW_TITLE = { today: '今日', exlib: '动作库', trend: '趋势', plan: '方案', me: '我的' };
    const topSub = S.view === 'exlib'
      ? '全部动作都有示范图，可按你的条件筛选'
      : `${fmtDate(today())} ${weekday(today())} · ${pl.dir === 'cut' ? '减脂中' : pl.dir === 'bulk' ? '增重中' : '维持中'}`;
    $('#topbar').innerHTML = `
      <div>
        <div class="topbar-title">${VIEW_TITLE[S.view] || '今日'}</div>
        <div class="topbar-sub">${topSub}</div>
      </div>
      <div class="row" style="gap:6px">
        ${isGuest()
        ? `<button class="pill pill-warn" data-act="guest-guide" style="border:0;cursor:pointer">游客体验</button>`
        : `<span class="pill pill-green">连续 ${streakDays()} 天</span>`}
      </div>`;
    renderGuestBar();
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    if (S.view === 'today') renderToday();
    if (S.view === 'exlib') renderLib();
    if (S.view === 'trend') renderTrend();
    if (S.view === 'plan') renderPlan();
    if (S.view === 'me') renderMe();
  }

  /* ---------- 今日 ---------- */
  function renderToday() {
    const cp = calcProfile();
    const prog = E.progress(weights(), cp);
    const pl = prog.plan;
    const meals = todayMeals();
    const wk = todayWorkouts();
    const intake = intakeOf(meals.filter(m => m.name !== SKIP_MARK));
    const burn = burnOf(wk);
    const lw = lastWeight();
    const prev = weights().length > 1 ? weights()[weights().length - 2] : null;
    const deltaJ = lw && prev ? E.round1((lw.weight - prev.weight) * KG2J) : 0;
    const dClass = deltaJ < 0 ? 'down' : (deltaJ > 0 ? 'up' : 'flat');
    const slotTarget = {
      b: Math.round(pl.targetIntake * 0.3),
      l: Math.round(pl.targetIntake * 0.4),
      d: Math.round(pl.targetIntake * 0.3)
    };

    const dow = new Date().getDay() || 7;
    const allItems = weekPlan()[dow] || [];
    const blocked = blockedNames('blocked_ex');
    const items = allItems.filter(it => !blocked.includes(it.n));
    const hasPreset = !!(extra().mealPreset && Object.keys(extra().mealPreset).length);

    const html = `
      <div class="card card-hero">
        <div class="hero">
          <div>
            <div class="hint">当前体重（7 日均线）</div>
            <div class="big-num">${toJ(prog.current)}<span class="unit">斤</span></div>
            <div class="delta ${dClass}">${prev ? '较上次 ' + (deltaJ > 0 ? '+' : '') + deltaJ + ' 斤' : '首次记录'}</div>
          </div>
          <button class="btn btn-primary" data-act="open-checkin">打卡</button>
        </div>
        <div class="progress mt16"><div class="progress-bar" style="width:${prog.pct}%"></div></div>
        <div class="between mt8">
          <span class="hint">起点 ${toJ(prog.startWeight)} 斤</span>
          <span class="hint">目标 ${toJ(prog.target)} 斤 · 完成 ${Math.round(prog.pct)}%</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">今日热量</h3>
          <span class="hint">目标 ${pl.targetIntake} kcal</span></div>
        <div id="ring-box"></div>
        <div class="stat-row">
          <div class="stat"><b>${Math.round(intake)}</b><span>已摄入</span></div>
          <div class="stat"><b>${Math.max(0, Math.round(pl.targetIntake - intake + burn))}</b><span>还可吃</span></div>
          <div class="stat"><b>${Math.round(burn)}</b><span>运动消耗</span></div>
        </div>
        ${pl.deficit > 0 && pl.dir === 'cut' ? `<div class="notice ${intake > pl.targetIntake ? '' : 'green'}">
          ${intake > pl.targetIntake
        ? '今天已超出目标 ' + Math.round(intake - pl.targetIntake) + ' kcal，明天回到正轨就行。'
        : '今天还剩 ' + Math.max(0, Math.round(pl.targetIntake - intake + burn)) + ' kcal 额度。'}
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-head">
          <h3 class="card-title">今日训练</h3>
          <span class="pill">${items.length ? items.length + ' 个动作' : '休息日'}</span>
        </div>
        <div id="session-box"></div>
      </div>

      ${libEntryCardHtml()}

      <div class="card">
        <div class="card-head"><h3 class="card-title">今日三餐</h3>
          <span class="hint">共 ${Math.round(intake)} kcal</span></div>
        <div class="meal-list">
          ${[['b', '早餐'], ['l', '午餐'], ['d', '晚餐']].map(([k, n]) =>
      mealSlotHtml(k, n, meals.filter(m => m.slot === k), slotTarget[k])).join('')}
        </div>
        ${hasPreset ? '' : `<button class="btn btn-block mt12" data-act="open-meal-preset">设一次三餐，以后每天只点确认</button>`}
      </div>`;

    $('#page').innerHTML = html;
    Charts.ring($('#ring-box'), intake, pl.targetIntake, 'kcal 已摄入',
      intake > pl.targetIntake ? '超出 ' + Math.round(intake - pl.targetIntake) : '剩余 ' + Math.max(0, Math.round(pl.targetIntake - intake)));
    renderSession(items, cp);
    bindLibThumbs();
  }

  /* ---------- 动作库（一级入口，随便翻） ---------- */
  const LIB_CAT_NAME = { chest: '胸', back: '背', legs: '腿', glutes: '臀', shoulders: '肩', arms: '臂', core: '核心', full: '全身' };
  const LIB_ENTRY = ['深蹲', '平板支撑', '开合跳', '俯卧撑', '臀桥', '卷腹'];
  const LIB_PAGE = 48;

  function libState() {
    if (!S.lib) S.lib = { cat: 'all', q: '', show: LIB_PAGE, mine: true, equips: [] };
    return S.lib;
  }
  function libThumb(e) { return 'assets/thumbs/' + e.id + '.jpg'; }
  function libHasThumb(e) {
    return !!((window.EX_MEDIA && window.EX_MEDIA[e.id]) || (window.EX_CDN && window.EX_CDN[e.id]));
  }
  /* 「全部」按部位轮流取，图墙一眼能看出动作有多杂 */
  function libAllPool() {
    const buckets = MUSCLE_CATS.map(([k]) => window.EXERCISES.filter(e => e.muscle === k));
    const out = [];
    for (let i = 0; i < 400; i++) {
      let more = false;
      for (const b of buckets) {
        if (b[i]) { out.push(b[i]); more = true; }
      }
      if (!more) break;
    }
    return out;
  }
  /* 通用过滤：训练条件 + 器械快捷筛选 + 搜索词（不含部位分类） */
  function libApplyFilters(list) {
    const st = libState();
    if (st.mine) {
      const cp = calcProfile();
      list = list.filter(e => E.exerciseAllowed(e, {
        equipment: cp.equipment || ['none'],
        limitations: cp.limitations || [],
        blacklist: []
      }));
    }
    if (st.equips && st.equips.length) {
      list = list.filter(e => st.equips.includes(e.equip));
    }
    const q = (st.q || '').trim().toLowerCase();
    if (q) {
      list = list.filter(e => e.name.toLowerCase().indexOf(q) >= 0 || (e.en || '').toLowerCase().indexOf(q) >= 0);
    }
    return list;
  }
  function libPool() {
    const st = libState();
    let list = st.cat === 'all' ? libAllPool() : window.EXERCISES.filter(e => e.muscle === st.cat);
    return libApplyFilters(list);
  }
  /* 部位胶囊上的计数 = 套用上面训练条件筛选后的数量，和筛选联动 */
  function libCatCount(k) {
    let list = k === 'all' ? libAllPool() : window.EXERCISES.filter(e => e.muscle === k);
    return libApplyFilters(list).length;
  }
  /* 当前分类+搜索范围内，「按我的条件」额外隐藏了多少个 */
  function libHiddenCount() {
    const st = libState();
    let list = st.cat === 'all' ? libAllPool() : window.EXERCISES.filter(e => e.muscle === st.cat);
    const q = (st.q || '').trim().toLowerCase();
    if (q) list = list.filter(e => e.name.toLowerCase().indexOf(q) >= 0 || (e.en || '').toLowerCase().indexOf(q) >= 0);
    if (st.equips && st.equips.length) list = list.filter(e => st.equips.includes(e.equip));
    const cp = calcProfile();
    const allowed = list.filter(e => E.exerciseAllowed(e, {
      equipment: cp.equipment || ['none'],
      limitations: cp.limitations || [],
      blacklist: []
    }));
    return list.length - allowed.length;
  }
  function libCellHtml(e) {
    const cp = calcProfile();
    const kcal = E.kcalOf(e.met, cp.weight, 20);
    const sub = e.unit === 'min' ? '20 分钟' : '3 组';
    return `<button class="lib-cell" data-act="lib-ex" data-name="${esc(e.name)}">
      <span class="lib-thumb"><i>${LIB_CAT_NAME[e.muscle] || '动作'}</i>${
      libHasThumb(e) ? `<img src="${libThumb(e)}" alt="${esc(e.name)} 示范" loading="lazy" />` : ''
    }</span>
      <span class="lib-name">${esc(e.name)}</span>
      <span class="lib-meta">${EQUIP_NAME[e.equip] || '徒手'} · ${sub}</span>
      <span class="lib-kcal">约 ${kcal} kcal</span>
    </button>`;
  }
  function libGridHtml() {
    const st = libState();
    const list = libPool();
    if (!list.length) {
      return `<div class="empty" style="grid-column:1/-1">这个范围里没有动作${st.mine ? '，可关掉「按我的条件」或点「调整条件」放宽器械' : ''}，也可以换个词搜：深蹲、拉伸、跳绳…</div>`;
    }
    const part = list.slice(0, st.show);
    const rest = list.length - part.length;
    return part.map(libCellHtml).join('')
      + (rest > 0 ? `<button class="lib-more" data-act="lib-more">继续看（还有 ${rest} 个）</button>` : '');
  }
  function libCatsHtml() {
    const st = libState();
    const cats = [['all', '全部']].concat(MUSCLE_CATS);
    const chips = cats.map(([k, n]) =>
      `<button class="lib-cat ${st.cat === k ? 'on' : ''}" data-act="lib-cat" data-v="${k}">${n}<em>${libCatCount(k)}</em></button>`).join('');
    return `<div class="lib-cats ${st.open ? 'open' : ''}" id="lib-cats">${chips}</div>
      <button class="lib-cat-toggle ${st.open ? 'open' : ''}" data-act="lib-cat-toggle" aria-label="展开/收起分类">▾</button>`;
  }
  /* 训练条件筛选行：开关 + 我的器械快捷筛选 */
  function libFiltersHtml() {
    const st = libState();
    const cp = calcProfile();
    const eqs = cp.equipment && cp.equipment.length ? cp.equipment : ['none'];
    const chips = [`<button class="lib-chip ${st.mine ? 'on' : ''}" data-act="lib-mine">${st.mine ? '✓ ' : ''}按我的条件</button>`]
      .concat(eqs.map(k => `<button class="lib-chip ${st.equips.includes(k) ? 'on' : ''}" data-act="lib-equip" data-v="${k}">${EQUIP_NAME[k] || k}</button>`))
      .concat([`<button class="lib-chip lib-chip-edit" data-act="edit-equip">调整条件</button>`]);
    return chips.join('');
  }
  /* 分类一行放不下时显示展开/收起按钮 */
  function layoutLibCats() {
    const cats = document.getElementById('lib-cats');
    const btn = document.querySelector('.lib-cat-toggle');
    if (!cats || !btn) return;
    const first = cats.querySelector('.lib-cat');
    const h = first ? first.offsetHeight : 34;
    const need = cats.scrollHeight > h + 4;
    btn.classList.toggle('show', need);
    cats.style.maxHeight = cats.classList.contains('open') ? 'none' : h + 'px';
  }
  function renderLib() {
    const st = libState();
    const list = libPool();
    const hidden = st.mine ? libHiddenCount() : 0;
    const head = st.cat === 'all' ? '全部动作' : (LIB_CAT_NAME[st.cat] || '') + '部动作';
    const html = `
      <div class="card card-lib-hero">
        <div class="lib-hero-head">
          <div>
            <div class="lib-hero-t">动作库</div>
            <div class="lib-hero-s">示范图 + 分步要领，点开照着做</div>
          </div>
        </div>
        <div class="lib-filters">${libFiltersHtml()}</div>
        ${st.mine ? `<div class="lib-filt-note">已按你的训练条件（器械 + 身体限制）筛选${hidden ? '，这个范围里隐藏了 ' + hidden + ' 个不适合的动作' : ''}。</div>` : ''}
        <div class="lib-search">
          <span class="lib-search-ico">🔍</span>
          <input id="lib-search" class="lib-input" placeholder="搜动作：深蹲、平板支撑、跳绳…" value="${esc(st.q || '')}" />
        </div>
      </div>

      <div class="lib-cats-row" id="lib-cats-row">${libCatsHtml()}</div>

      <div class="card lib-list-card">
        <div class="card-head"><h3 class="card-title">${head}</h3>
          <span class="hint" id="lib-count">共 ${list.length} 个 · 点卡片看示范</span></div>
        <div class="lib-grid" id="lib-grid">${libGridHtml()}</div>
      </div>`;
    $('#page').innerHTML = html;
    bindLibThumbs();
    layoutLibCats();
  }
  /* 缩略图缺失时退回部位占位块，避免破图 */
  function bindLibThumbs(root) {
    (root || document).querySelectorAll('.lib-thumb img, .lib-entry-thumb img').forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', () => img.remove());
    });
  }
  function libEntryCardHtml() {
    const picks = LIB_ENTRY.map(n => window.EXERCISES.find(e => e.name === n)).filter(Boolean).slice(0, 5);
    return `<div class="card card-lib-entry" data-act="goto-lib">
      <div class="between">
        <div class="lib-entry-main">
          <div class="lib-entry-t">动作库 · ${window.EXERCISES.length} 个动作</div>
          <div class="lib-entry-s">带示范图和分步要领，随时翻着照做</div>
        </div>
        <span class="lib-entry-go">去翻翻 →</span>
      </div>
      <div class="lib-entry-strip">
        ${picks.map(e => `<span class="lib-entry-thumb"><i>${LIB_CAT_NAME[e.muscle] || '动作'}</i>${
      libHasThumb(e) ? `<img src="${libThumb(e)}" alt="${esc(e.name)}" loading="lazy" />` : ''
    }</span>`).join('')}
      </div>
    </div>`;
  }

  function cnQty(n) {
    if (n === 0.5) return '半';
    const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (Number.isInteger(n) && n >= 0 && n <= 10) return CN[n];
    return String(n);
  }

  function amountText(name, grams) {
    const g = Number(grams) || 0;
    let h = null;
    const f = window.FOODS.find(x => x.name === name);
    if (f && f.hand) h = f.hand;
    else {
      const c = St.listCustom('custom_food').find(x => x.name === name);
      if (c) {
        const D = { staple: { u: '拳', g: 120 }, grain: { u: '拳', g: 150 }, protein: { u: '巴掌', g: 120 }, veg: { u: '拳', g: 100 }, fruit: { u: '个', g: 150 }, nut: { u: '把', g: 20 }, combo: { u: '份', g: 300 } };
        h = D[(c.payload && c.payload.cat) || 'protein'] || { u: '份', g: 100 };
      }
    }
    if (!h || !h.g) return g + 'g';
    const q = Math.max(0.5, Math.round(g / h.g * 2) / 2);
    return g + 'g（约' + cnQty(q) + h.u + '）';
  }

  function mealSlotHtml(slot, name, items, target) {
    const pre = mealPreset(slot);
    const skipped = items.some(m => m.name === SKIP_MARK);
    const eaten = items.filter(m => m.name !== SKIP_MARK);
    const sum = Math.round(intakeOf(eaten));

    if (!pre) {
      /* 没设预设但也记了吃的：直接展示已记内容，别让记录“隐形” */
      if (eaten.length) {
        const actual = eaten.map(m => esc(m.name) + ' ' + amountText(m.name, m.grams)).join(' · ');
        return `<div class="meal-row">
          <div class="between"><b>${name}</b><span class="pill pill-green">已记 ${sum} kcal</span></div>
          <div class="hint meal-desc">${actual}</div>
          <div class="chips mt8">
            <button class="chip chip-sm" data-act="open-food" data-slot="${slot}">再加一点</button>
            <button class="chip chip-sm" data-act="reset-meal" data-slot="${slot}">重记</button>
          </div>
        </div>`;
      }
      return `<div class="meal-row">
        <div class="between"><b>${name}</b><span class="hint">目标 ${target} kcal</span></div>
        <div class="hint meal-desc">还没设预设</div>
        <div class="chips mt8">
          <button class="chip chip-sm" data-act="edit-preset-meal" data-slot="${slot}">去设定</button>
          <button class="chip chip-sm" data-act="open-food" data-slot="${slot}">临时选一次</button>
        </div>
      </div>`;
    }

    const desc = pre.items.map(i => esc(i.name) + ' ' + amountText(i.name, i.grams)).join(' · ');

    if (skipped) {
      return `<div class="meal-row">
        <div class="between"><b>${name}</b><span class="pill pill-warn">今天没吃</span></div>
        <div class="hint meal-desc">${esc(desc)}</div>
        <div class="chips mt8"><button class="chip chip-sm" data-act="reset-meal" data-slot="${slot}">重记</button></div>
      </div>`;
    }

    if (eaten.length) {
      const diff = sum - pre.kcal;
      const tag = Math.abs(diff) >= 15 ? '（' + (diff > 0 ? '+' : '') + diff + '）' : '';
      const actual = eaten.map(m => esc(m.name) + ' ' + amountText(m.name, m.grams)).join(' · ');
      return `<div class="meal-row">
        <div class="between"><b>${name}</b>
          <span class="pill pill-green">已记 ${sum} kcal${tag}</span></div>
        <div class="hint meal-desc">${actual}</div>
        <div class="chips mt8"><button class="chip chip-sm" data-act="reset-meal" data-slot="${slot}">重记</button></div>
      </div>`;
    }

    return `<div class="meal-row">
      <div class="between"><b>${name}</b><span class="hint">${pre.kcal} kcal</span></div>
      <div class="hint meal-desc">${esc(desc)}</div>
      <div class="chips mt8">
        <button class="chip chip-sm" data-act="meal-eat" data-slot="${slot}" data-f="1">吃了</button>
        <button class="chip chip-sm" data-act="meal-eat" data-slot="${slot}" data-f="0">没吃</button>
        <button class="chip chip-sm" data-act="meal-eat" data-slot="${slot}" data-f="1.15">多吃了一丢丢</button>
        <button class="chip chip-sm" data-act="meal-eat" data-slot="${slot}" data-f="0.85">少吃了一丢丢</button>
      </div>
    </div>`;
  }

  function renderSession(items, cp) {
    const box = $('#session-box');
    if (!items || !items.length) {
      box.innerHTML = `<div class="empty">今天按计划是休息日。<br/>想调训练内容就点「方案」改每周计划。</div>
        <button class="btn btn-block mt12" data-act="custom-ex">＋ 我今天练了别的</button>`;
      return;
    }
    const doneNames = new Set(todayWorkouts().map(w => w.name));
    const rows = items.map(it => {
      const ex = window.EXERCISES.find(e => e.name === it.n);
      const met = ex ? ex.met : 4;
      const mins = E.estimateMinutes(it);
      const kcal = E.kcalOf(met, cp.weight, mins);
      const done = doneNames.has(it.n);
      return `<div class="item">
        <div class="item-main">
          <div class="item-name" data-act="ex-detail" data-name="${esc(it.n)}" style="text-decoration:underline dotted;cursor:pointer">${esc(it.n)}</div>
          <div class="item-meta">${it.min ? it.min + ' 分钟' : (it.sets || 3) + ' 组 × ' + (it.reps || '12')} · 约 ${kcal} kcal</div>
        </div>
        <div class="item-actions">
          ${done ? '<span class="done-mark">已完成</span>' : `<button class="btn btn-mini btn-primary" data-act="log-ex" data-name="${esc(it.n)}" data-min="${mins}" data-kcal="${kcal}">完成</button>`}
          <button class="btn btn-mini" data-act="swap-ex" data-name="${esc(it.n)}" data-muscle="${ex ? ex.muscle : 'full'}">换</button>
          <button class="btn btn-mini" data-act="block-ex" data-name="${esc(it.n)}">做不了</button>
        </div>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="list">${rows}</div>
      <button class="btn btn-block mt12" data-act="custom-ex">＋ 我今天练了别的</button>`;
  }

  /* ---------- 趋势 ---------- */
  function renderTrend() {
    const cp = calcProfile();
    const prog = E.progress(weights(), cp);
    const pl = prog.plan;
    const series = prog.series;
    const days = S.range;

    const html = `
      <div class="card">
        <div class="between">
          <div>
            <div class="hint">距离目标</div>
            <div class="big-num">${toJ(Math.abs(prog.current - prog.target))}<span class="unit">斤</span></div>
            <div class="delta ${prog.gap <= 0 ? 'down' : 'up'}">
              ${prog.gap <= 0 ? '比计划快 ' : '比计划慢 '}${toJ(Math.abs(prog.gap))} 斤</div>
          </div>
          <div style="text-align:right">
            <div class="hint">预计达成</div>
            <div style="font-size:17px;font-weight:600">${prog.eta || '—'}</div>
            <div class="hint">${prog.remainDays >= 0 ? '距计划日 ' + prog.remainDays + ' 天' : '已超计划日 ' + Math.abs(prog.remainDays) + ' 天'}</div>
          </div>
        </div>
        <div class="progress mt16"><div class="progress-bar" style="width:${prog.pct}%"></div></div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">体重曲线 <small>单位：斤</small></h3>
          <div class="seg">
            ${[[7, '7天'], [30, '30天'], [90, '90天'], [0, '全部']].map(([v, n]) =>
      `<button class="seg-item ${S.range === v ? 'active' : ''}" data-act="range" data-v="${v}">${n}</button>`).join('')}
          </div>
        </div>
        <div id="weight-chart"></div>
        <div class="row mt8" style="gap:14px;flex-wrap:wrap">
          <span class="hint">● 实测</span><span class="hint" style="color:#0b7d57">━ 7 日均线</span>
          <span class="hint" style="color:#94a3b8">┅ 计划线</span><span class="hint" style="color:#f97316">┈ 目标</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">热量进出 <small>近 14 天</small></h3></div>
        <div id="cal-chart"></div>
        <div class="row mt8" style="gap:14px">
          <span class="hint" style="color:#f0a04b">■ 摄入</span>
          <span class="hint" style="color:#4aa3a0">■ 运动消耗</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">打卡日历 <small>近 12 周</small></h3></div>
        <div id="heat"></div>
        <div class="hint mt8">共打卡 ${weights().length} 天，最长连续 ${maxStreak()} 天</div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">训练完成率 <small>近 4 周</small></h3></div>
        <div id="train-rate"></div>
      </div>`;

    $('#page').innerHTML = html;

    const seriesJ = series.map(x => ({ ...x, weight: E.round1(x.weight * KG2J), avg: E.round1(x.avg * KG2J) }));
    const planJ = { ...pl, w0: pl.w0 * KG2J, w1: pl.w1 * KG2J, deltaW: pl.deltaW * KG2J };
    const progJ = { ...prog, current: prog.current * KG2J, slope: prog.slope * KG2J };

    Charts.weightChart($('#weight-chart'), {
      series: seriesJ, plan: planJ, progress: progJ, range: S.range,
      startDate: cp.startDate, targetDate: cp.targetDate
    });

    const rows = [];
    for (let i = 13; i >= 0; i--) {
      const d = E.addDays(today(), -i);
      rows.push({
        date: d,
        intake: intakeOf(St.state.meals.filter(m => m.date === d)),
        burn: burnOf(St.state.workouts.filter(w => w.date === d))
      });
    }
    Charts.calorieChart($('#cal-chart'), rows, pl.targetIntake);
    Charts.heatmap($('#heat'), weights().map(w => w.date), 12);

    const items = [];
    for (let w = 3; w >= 0; w--) {
      const end = E.addDays(today(), -w * 7), start = E.addDays(end, -6);
      const logs = (St.state.workouts || []).filter(x => x.date >= start && x.date <= end);
      const days = new Set(logs.map(x => x.date)).size;
      items.push({ label: fmtDate(start) + ' 那周', value: days, text: days + ' 天' });
    }
    Charts.miniBars($('#train-rate'), items);
  }

  function maxStreak() {
    const ds = [...new Set(weights().map(w => w.date))].sort();
    let best = 0, cur = 0, prev = null;
    ds.forEach(d => {
      if (prev && E.daysBetween(prev, d) === 1) cur++; else cur = 1;
      prev = d; best = Math.max(best, cur);
    });
    return best;
  }

  /* ---------- 方案 ---------- */
  function renderPlan() {
    const cp = calcProfile();
    const tpl = currentTemplate();
    const plan = weekPlan();
    const dow = new Date().getDay() || 7;
    const monday = E.addDays(today(), 1 - dow);
    const fi = E.planFreqInfo(tpl, cp.freqMode || 'weekly', cp.freqCount || tplDefaultFreq(tpl, cp.freqMode || 'weekly'));
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    const dayText = fi.days.map(d => '周' + WD[d - 1]).join('、');
    const freqText = fi.mode === 'monthly'
      ? `按月安排 · 每月 ${fi.count} 次 ≈ ${perWeekLabel(fi.count)}`
      : `按周安排 · 每周 ${fi.count} 天`;

    const html = `
      <div class="card">
        <div class="card-head"><h3 class="card-title">训练方案</h3>
          <button class="btn btn-mini" data-act="choose-plan">换模板</button></div>
        <div style="font-size:17px;font-weight:600;margin-bottom:4px">${esc(tpl.name)}</div>
        <div class="sub">${tpl.desc}</div>
        <div class="row mt12" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn-mini ${fi.mode === 'weekly' ? 'btn-primary' : ''}" data-act="freq-mode" data-v="weekly">按周安排</button>
          <button class="btn btn-mini ${fi.mode === 'monthly' ? 'btn-primary' : ''}" data-act="freq-mode" data-v="monthly">按月安排</button>
          <button class="btn btn-mini" data-act="freq-edit">改次数</button>
        </div>
        <div class="kv mt12" style="padding:10px 12px;background:#f5f9f7;border-radius:10px">
          <div class="kv-row"><span>当前排期</span><b>${freqText}</b></div>
          <div class="kv-row"><span>训练日</span><b>${dayText}</b></div>
        </div>
        <div class="notice mt12">改次数或切换按周/按月，下面的每周计划会立刻重排，不用再手动点重排。</div>
        <button class="btn btn-block mt12" data-act="regen-plan">按模板重排这一周</button>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">每周计划</h3>
          <span class="hint">点「编辑」换动作</span></div>
        <div class="list">
          ${Array.from({ length: 7 }).map((_, i) => {
      const d = E.addDays(monday, i);
      const idx = i + 1;
      const its = plan[idx] || [];
      const isToday = d === today();
      return `<div class="item" style="${isToday ? 'background:#f7fbf9;border-radius:10px;padding:11px 10px' : ''}">
              <div style="width:44px;flex-shrink:0">
                <div style="font-size:13px;font-weight:${isToday ? 600 : 400}">${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i]}</div>
                <div class="hint">${fmtDate(d)}</div>
              </div>
              <div class="item-main">
                <div class="item-name">${its.length ? its.map(x => esc(x.n)).join(' · ') : '<span class="hint">休息</span>'}</div>
                <div class="item-meta">${its.length ? its.length + ' 个动作' : '—'}</div>
              </div>
              <button class="btn btn-mini" data-act="edit-day" data-dow="${idx}">编辑</button>
            </div>`;
    }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">加练</h3>
          <span class="hint">只计入今天，不改每周计划</span></div>
        <button class="btn btn-block" data-act="custom-ex">＋ 我今天练了别的</button>
      </div>`;

    $('#page').innerHTML = html;
  }

  /* ---------- 我的 ---------- */
  function goalFingerprint(pl) {
    return [pl.w0, pl.w1, pl.days].join('|');
  }
  function warnNoticeHtml(pl) {
    if (!pl.warnings.length) return '';
    const fp = goalFingerprint(pl);
    let dismissed = null;
    try { dismissed = localStorage.getItem('bm_warn_dismissed'); } catch (err) {}
    if (dismissed === fp) return '';
    return `<div class="notice warn-dismiss">
      <span>${pl.warnings.map(w => esc(w)).join('<br/>')}</span>
      <button class="notice-x" data-act="dismiss-warn" data-fp="${fp}" aria-label="关闭提醒">×</button>
    </div>`;
  }
  function renderMe() {
    const cp = calcProfile();
    const pl = E.progress(weights(), cp).plan;
    const cusEx = St.listCustom('custom_ex');
    const cusFd = St.listCustom('custom_food');
    const blkEx = blockedNames('blocked_ex');
    const blkFd = blockedNames('blocked_food');

    const email = St.session && St.session.user && St.session.user.email ? St.session.user.email : '';
    const html = `
      <div class="card user-card ${isGuest() ? 'is-guest' : ''}" data-act="open-profile">
        <div class="avatar">${esc(userAvatar())}</div>
        <div class="user-info">
          <div style="font-size:16px;font-weight:600">${esc(userName())}</div>
          <div class="hint">${esc(isGuest() ? '未登录 · 数据只在本页' : (email || '已登录'))}</div>
        </div>
        <span class="user-chev">›</span>
      </div>

      ${isGuest() ? `<div class="card guest-cta">
        <div class="card-head"><h3 class="card-title">登录后这些才不会丢</h3>
          <span class="pill pill-warn">游客</span></div>
        <div class="guest-points">
          <div>体重、三餐、训练记录存到云端，换手机也在</div>
          <div>按你的性别和年龄算代谢，强度更准</div>
          <div>数据只属于你，不与他人共享</div>
        </div>
        <button class="btn btn-primary btn-block mt12" data-act="guest-signup">注册 / 登录</button>
        <button class="btn btn-ghost btn-block mt8" data-act="guest-guide">看看游客模式怎么用</button>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><h3 class="card-title">目标与身体数据</h3>
          <button class="btn btn-mini" data-act="edit-goal">修改</button></div>
        <div class="stat-row">
          <div class="stat"><b>${toJ(pl.w0)}</b><span>起始 斤</span></div>
          <div class="stat"><b>${toJ(pl.w1)}</b><span>目标 斤</span></div>
          <div class="stat"><b>${pl.days}</b><span>计划天数</span></div>
        </div>
        <div class="hint mt12">${cp.startDate || '-'} → ${cp.targetDate || '-'} · ${GENDER_NAME[cp.gender] || '-'} · 目标摄入 ${pl.targetIntake} kcal/天（已按性别计算代谢）</div>
        ${warnNoticeHtml(pl)}
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">训练条件</h3>
          <button class="btn btn-mini" data-act="edit-equip">修改</button></div>
        <div class="kv">
          <div class="kv-row"><span>器械</span><b>${(cp.equipment || ['none']).map(k => EQUIP_NAME[k] || k).join('、')}</b></div>
          <div class="kv-row"><span>限制</span><b>${(cp.limitations || []).length ? cp.limitations.map(k => LIM_NAME[k] || k).join('、') : '无'}</b></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">饮食偏好</h3>
          <button class="btn btn-mini" data-act="edit-diet">修改</button></div>
        <div class="kv">
          <div class="kv-row"><span>方式</span><b>${(window.DIET_STYLES.find(d => d.id === cp.dietStyle) || {}).name || '常规'}</b></div>
          <div class="kv-row"><span>忌口</span><b>${(cp.dislikes || []).length ? cp.dislikes.join('、') : '无'}</b></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">三餐预设</h3>
          <button class="btn btn-mini" data-act="open-meal-preset">设置</button></div>
        <div class="kv">
          ${[['b', '早餐'], ['l', '午餐'], ['d', '晚餐']].map(([k, n]) => {
      const p = (extra().mealPreset || {})[k];
      return `<div class="kv-item">
              <div class="kv-row"><span>${n}</span><b class="${p ? '' : 'kv-empty'}">${p ? p.kcal + ' kcal' : '未设置'}</b></div>
              ${p ? `<div class="kv-sub">${p.items.map(i => i.name).join(' / ')}</div>` : ''}
            </div>`;
    }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">自定义内容</h3></div>
        <div class="kv">
          <div class="kv-row"><span>自定义动作</span>
            <span class="kv-act"><b>${cusEx.length} 个</b>
              <button class="btn btn-mini" data-act="custom-ex">新增</button></span></div>
          <div class="kv-row"><span>自定义食物</span>
            <span class="kv-act"><b>${cusFd.length} 个</b>
              <button class="btn btn-mini" data-act="custom-food">新增</button></span></div>
        </div>
        ${(cusEx.length + cusFd.length) ? `<div class="chips mt12">
          ${cusEx.map(c => `<button class="chip" data-act="del-custom" data-id="${c.id}">${esc(c.name)} ×</button>`).join('')}
          ${cusFd.map(c => `<button class="chip" data-act="del-custom" data-id="${c.id}">${esc(c.name)} ×</button>`).join('')}
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">已屏蔽</h3></div>
        <div class="hint">被屏蔽的动作和食物不会再出现在推荐里。</div>
        ${(blkEx.length + blkFd.length) ? `<div class="chips mt12">
          ${St.state.customs.filter(c => c.payload && c.payload.blocked).map(c =>
      `<button class="chip" data-act="unblock" data-id="${c.id}">${esc(c.name)} ↺</button>`).join('')}
        </div>` : '<div class="hint mt8">暂无屏蔽项</div>'}
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">数据</h3></div>
        <div class="hint">共 ${weights().length} 条体重记录、${(St.state.workouts || []).length} 条训练、${(St.state.meals || []).length} 条饮食。</div>
        <button class="btn btn-primary btn-block mt12" data-act="export">生成我的进度分享图</button>
      </div>`;

    $('#page').innerHTML = html;
  }

  const EQUIP_NAME = { none: '徒手', dumbbell: '哑铃', barbell: '杠铃', machine: '固定器械', cable: '龙门架', band: '弹力带', kettlebell: '壶铃', rope: '跳绳', treadmill: '跑步机', bike: '单车', rower: '划船机', pool: '泳池' };
  const LIM_NAME = { knee: '膝盖不适', back: '腰部不适', shoulder: '肩部不适' };
  const GENDER_NAME = { male: '男', female: '女' };

  /* ============ 游客引导 ============ */
  function openGuestGuide() {
    markGuestGuide();
    openSheet('先随便看看', `
      <div class="guide-hero">
        <div class="guide-badge">游客模式</div>
        <div class="hint">下面这些数据都是样例，你可以当成自己的记录随便改</div>
      </div>
      <div class="guide-steps">
        <div class="guide-step"><b>1</b><span>点「打卡」改体重，趋势页的曲线会跟着变</span></div>
        <div class="guide-step"><b>2</b><span>底部「动作」是完整动作库，901 个动作都能翻图、看步骤</span></div>
        <div class="guide-step"><b>3</b><span>在「方案」里换模板、调器械和限制，动作库会跟着过滤</span></div>
        <div class="guide-step"><b>4</b><span>「今日三餐」可以加食物，热量环即时算出来</span></div>
      </div>
      <div class="notice mt12">改动只留在这一页：关掉或刷新就恢复样例，<b>不会写进数据库</b>。</div>
      <div class="hint mt12">注册后数据存到你的账号下，换设备也在；方案还会按你的性别、年龄重新算强度。</div>
      <button class="btn btn-primary btn-block mt12" data-act="guest-signup">注册 / 登录</button>
      <button class="btn btn-ghost btn-block mt8" data-act="close-sheet">先体验一下</button>`);
  }

  function openProfileCenter() {
    const cp = calcProfile();
    const pl = E.progress(weights(), cp).plan;
    const u = (St.session && St.session.user) || {};
    const age = cp.birthYear ? new Date().getFullYear() - cp.birthYear : '-';
    const body = `
      <div class="pf-hero">
        <div class="avatar avatar-lg">${esc(userAvatar())}</div>
        <div style="font-size:16px;font-weight:600">${esc(userName())}</div>
        <div class="hint">${esc(isGuest() ? '未登录 · 改动不保存' : (u.email || '已登录'))}</div>
      </div>
      <div class="kv">
        <div class="kv-row"><span>账号</span><b>${isGuest() ? '游客（未登录）' : esc(u.email || u.phone || '已登录') + (u.phone && u.email ? ' / ' + esc(u.phone) : '')}</b></div>
        <div class="kv-row tap" data-act="pf-gender"><span>性别</span><b>${GENDER_NAME[cp.gender] || '未设置'}<i class="kv-chev">改 ›</i></b></div>
        <div class="kv-row tap" data-act="pf-birth"><span>年龄</span><b>${age} 岁${cp.birthYear ? '' : '（未设置出生年份）'}<i class="kv-chev">改 ›</i></b></div>
        <div class="kv-row tap" data-act="pf-height"><span>身高</span><b>${cp.height ? cp.height + ' cm' : '-'}<i class="kv-chev">改 ›</i></b></div>
        <div class="kv-row tap" data-act="pf-goal"><span>目标</span><b>${toJ(pl.w0)} → ${toJ(pl.w1)} 斤 · ${pl.days} 天<i class="kv-chev">改 ›</i></b></div>
        <div class="kv-row"><span>每日目标摄入</span><b>${pl.targetIntake} kcal<span class="hint">（按性别与目标自动算）</span></b></div>
        ${!isGuest() && u.created_at ? `<div class="kv-row"><span>注册时间</span><b>${String(u.created_at).slice(0, 10)}</b></div>` : ''}
      </div>
      ${isGuest() ? `
      <button class="btn btn-primary btn-block mt12" data-act="guest-signup">注册 / 登录，把数据存下来</button>
      <div class="hint mt8" style="text-align:center">上面这些资料在游客模式也能改，但刷新页面就回到样例</div>`
        : `
      <button class="btn btn-block mt12" data-act="pwd-edit">修改密码</button>
      <button class="btn btn-danger btn-block mt8" data-act="signout">退出登录</button>
      <div class="hint mt8" style="text-align:center">退出后数据保留在云端，下次登录还在</div>`}`;
    openSheet('个人中心', body, '');
  }

  function pfRelayout() { renderApp(); openProfileCenter(); }

  /* ---------- 分享图（SVG → PNG） ---------- */
  function buildShareSvg() {
    const cp = calcProfile();
    const pr = E.progress(weights(), cp);
    const pl = pr.plan;
    const curJ = toJ(pr.current);
    const delta = Math.round((curJ - toJ(pl.w0)) * 10) / 10;
    const towardTarget = delta !== 0 && Math.sign(delta) === Math.sign(pl.deltaW);
    const deltaColor = delta === 0 ? '#6b7280' : (towardTarget ? '#10b981' : '#f59e0b');
    const pct = Math.round(pr.pct);
    const streak = streakDays();

    // 曲线
    const s = pr.series || [];
    const PX0 = 80, PX1 = 680, PY0 = 620, PY1 = 810;
    let chart = '', axis = '';
    if (s.length >= 2) {
      const vals = s.map(x => toJ(x.avg));
      const tJ = toJ(pl.w1);
      let lo = Math.min(...vals, tJ), hi = Math.max(...vals, tJ);
      const pad = Math.max((hi - lo) * 0.15, 1);
      lo -= pad; hi += pad;
      const X = i => PX0 + (PX1 - PX0) * i / (s.length - 1);
      const Y = v => PY1 - (PY1 - PY0) * (v - lo) / (hi - lo);
      const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      // 目标线
      chart += `<line x1="${PX0}" y1="${Y(tJ).toFixed(1)}" x2="${PX1}" y2="${Y(tJ).toFixed(1)}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="6 5"/>`;
      chart += `<text x="${PX1}" y="${(Y(tJ) - 8).toFixed(1)}" text-anchor="end" font-size="17" fill="#9ca3af">目标 ${tJ}</text>`;
      // 面积 + 线 + 末点
      chart += `<polygon points="${X(0)},${PY1} ${pts} ${PX1},${PY1}" fill="#10b981" opacity="0.08"/>`;
      chart += `<polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      const li = s.length - 1;
      chart += `<circle cx="${X(li).toFixed(1)}" cy="${Y(vals[li]).toFixed(1)}" r="6" fill="#10b981" stroke="#fff" stroke-width="2.5"/>`;
      const d0 = String(s[0].date), d1 = String(s[li].date);
      axis = `<text x="${PX0}" y="845" font-size="16" fill="#9ca3af">${d0.slice(5).replace('/', '-')}</text>
              <text x="${PX1}" y="845" text-anchor="end" font-size="16" fill="#9ca3af">${d1.slice(5).replace('/', '-')}</text>`;
    } else {
      chart = `<text x="380" y="720" text-anchor="middle" font-size="20" fill="#9ca3af">记录满 2 天后，这里会出现你的体重曲线</text>`;
    }

    const stat = (x, label, val, color) => `
      <rect x="${x}" y="440" width="158" height="86" rx="14" fill="#ffffff" stroke="#e8eef0"/>
      <text x="${x + 79}" y="476" text-anchor="middle" font-size="17" fill="#6b7280">${label}</text>
      <text x="${x + 79}" y="512" text-anchor="middle" font-size="27" font-weight="700" fill="${color || '#111827'}">${val}</text>`;

    const etaTxt = pr.eta ? '约 ' + String(pr.eta).slice(5).replace('/', '/') + ' 达成' : (pr.etaNote || '坚持记录会更准');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1060" viewBox="0 0 750 1060">
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#0b8f66"/>
        </linearGradient>
      </defs>
      <rect width="750" height="1060" fill="#f2f6f4"/>
      <rect width="750" height="180" fill="url(#hg)"/>
      <text x="60" y="86" font-size="38" font-weight="800" fill="#ffffff">见轻</text>
      <text x="60" y="126" font-size="20" fill="#ffffff" opacity="0.85">减重进度报告</text>
      <text x="690" y="86" text-anchor="end" font-size="18" fill="#ffffff" opacity="0.9">${String(cp.startDate || today()).replace(/-/g, '/')}</text>
      <text x="690" y="116" text-anchor="end" font-size="18" fill="#ffffff" opacity="0.9">目标日 ${String(cp.targetDate || '-').replace(/-/g, '/')}</text>

      <rect x="40" y="210" width="670" height="196" rx="20" fill="#ffffff" stroke="#e8eef0"/>
      <text x="70" y="256" font-size="19" fill="#6b7280">当前体重</text>
      <text x="70" y="330" font-size="62" font-weight="800" fill="#111827">${curJ}<tspan font-size="26" font-weight="600" fill="#6b7280"> 斤</tspan></text>
      <text x="680" y="330" text-anchor="end" font-size="26" font-weight="700" fill="${deltaColor}">${delta > 0 ? '+' : ''}${delta} 斤</text>
      <rect x="70" y="360" width="610" height="10" rx="5" fill="#e5e7eb"/>
      <rect x="70" y="360" width="${Math.max(2, Math.round(610 * pct / 100))}" height="10" rx="5" fill="#10b981"/>
      <text x="680" y="396" text-anchor="end" font-size="17" fill="#6b7280">目标进度 ${pct}%</text>

      ${stat(40, '起始', toJ(pl.w0) + ' 斤')}
      ${stat(210, '目标', toJ(pl.w1) + ' 斤', '#10b981')}
      ${stat(380, '已变化', (delta > 0 ? '+' : '') + delta + ' 斤', deltaColor)}
      ${stat(552, '剩余天数', pr.remainDays + ' 天')}

      <rect x="40" y="556" width="670" height="330" rx="20" fill="#ffffff" stroke="#e8eef0"/>
      <text x="70" y="600" font-size="20" font-weight="700" fill="#111827">体重曲线（斤）</text>
      <text x="680" y="600" text-anchor="end" font-size="17" fill="#6b7280">${etaTxt}</text>
      <rect x="80" y="620" width="600" height="190" rx="12" fill="#f8faf9"/>
      ${chart}${axis}

      <rect x="40" y="916" width="670" height="86" rx="20" fill="#ffffff" stroke="#e8eef0"/>
      <text x="380" y="968" text-anchor="middle" font-size="20" fill="#374151">已记录 ${weights().length} 天 · 连续打卡 ${streak} 天 · 每日目标 ${pl.targetIntake} kcal</text>

      <text x="380" y="1032" text-anchor="middle" font-size="19" fill="#6b7280">每天一个数字，看见身体的变化</text>
    </svg>`;
    return { svg, w: 750, h: 1060 };
  }

  function openShareCard() {
    const { svg } = buildShareSvg();
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    S.shareImg = dataUrl;
    const canShare = !!(navigator.canShare && navigator.share);
    openSheet('我的进度报告', `
      <div style="text-align:center">
        <img id="share-prev" alt="报告预览"
          style="width:100%;max-width:330px;border-radius:16px;box-shadow:var(--shadow-md)" />
      </div>
      ${canShare ? `<button class="btn btn-primary btn-block mt12" data-act="share-send">分享给朋友</button>` : ''}
      <button class="btn ${canShare ? '' : 'btn-primary'} btn-block mt8" data-act="share-save">保存图片</button>
      <div class="hint mt8" style="text-align:center">图片格式，微信、朋友圈可以直接发</div>`, '', 'sheet-tight');
    $('#share-prev').src = dataUrl;
  }

  function shareCanvas() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 750 * 2; c.height = 1060 * 2;
        const ctx = c.getContext('2d');
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0, 750, 1060);
        c.toBlob(b => b ? resolve(b) : reject(new Error('生成图片失败')), 'image/png');
      };
      img.onerror = () => reject(new Error('生成图片失败'));
      img.src = S.shareImg;
    });
  }

  async function saveSharePng() {
    try {
      const blob = await shareCanvas();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '见轻报告-' + today() + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('图片已保存');
    } catch (e) { toast(e.message || '生成图片失败'); }
  }

  async function sendSharePng() {
    try {
      const blob = await shareCanvas();
      const file = new File([blob], '见轻报告-' + today() + '.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '我的见轻记录' });
      } else {
        toast('当前浏览器不支持直接分享，试试「保存图片」');
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') toast(e.message || '分享失败');
    }
  }

  /* ============ 弹层 ============ */
  function openSheet(title, bodyHtml, footHtml, bodyClass, sheetClass) {
    $('#sheet-root').innerHTML = `
      <div class="sheet-mask" data-act="sheet-mask">
        <div class="sheet ${sheetClass || ''}">
          <div class="sheet-head"><div class="sheet-title">${esc(title)}</div>
            <button class="close-x" data-act="close-sheet">×</button></div>
          <div class="sheet-body ${bodyClass || ''}">${bodyHtml}</div>
          ${footHtml ? `<div class="sheet-foot">${footHtml}</div>` : ''}
        </div>
      </div>`;
  }
  function closeSheet() {
    const st = S.sheetStack;
    if (st && st.length) {
      const snap = st.pop();
      $('#sheet-root').innerHTML = snap.html;
      const body = $('#sheet-root .sheet-body');
      if (body) body.scrollTop = snap.scroll || 0;
      return;
    }
    $('#sheet-root').innerHTML = ''; S.sheet = null;
  }

  function closeAllSheets() {
    S.sheetStack = [];
    S.sheet = null;
    $('#sheet-root').innerHTML = '';
  }

  /* ---------- 打卡 ---------- */
  function openCheckin() {
    const lw = lastWeight();
    S.ciWeight = lw ? toJ(lw.weight) : toJ(calcProfile().startWeight || 70);
    S.ciDate = today();
    renderCheckin();
  }

  function renderCheckin() {
    const last7 = weights().slice(-7).map(w => w.weight);
    const avgJ = last7.length ? toJ(last7.reduce((a, b) => a + b, 0) / last7.length) : null;
    openSheet('记录体重', `
      <div class="field"><label>日期</label>
        <button class="field-pick" data-act="ci-pick-date">
          <span><span class="v">${S.ciDate.replace(/-/g, '/')}</span>
            <span class="u">${S.ciDate === today() ? '今天' : '补录'}</span></span>
          <span class="ar">滑动选择 ›</span>
        </button>
      </div>
      <div class="field"><label>体重</label>
        <button class="field-pick" data-act="ci-pick-weight">
          <span><span class="v">${S.ciWeight}</span><span class="u">斤</span></span>
          <span class="ar">滑动选择 ›</span>
        </button>
      </div>
      <div class="field"><label>腰围（cm，可不填）</label>
        <input class="input" id="ci-waist" type="number" inputmode="decimal" step="0.1" placeholder="选填" /></div>
      <div class="hint">${avgJ ? '近 7 次平均 ' + avgJ + ' 斤。' : ''}建议固定早晨空腹、同一台秤，波动才可比。</div>
      <div class="err" id="ci-err"></div>`,
      `<button class="btn btn-primary btn-block" data-act="save-checkin">保存</button>`);
  }

  async function saveCheckin() {
    const d = S.ciDate || today();
    const j = Number(S.ciWeight);
    const waistEl = $('#ci-waist');
    const waist = waistEl && waistEl.value ? Number(waistEl.value) : null;
    const err = $('#ci-err');
    if (!(j > 40 && j < 700)) { err.textContent = '体重填得不太对'; return; }
    const kg = toKg(j);
    const prev = weights().filter(x => x.date < d).slice(-1)[0];
    if (prev && Math.abs(kg - prev.weight) > 3) {
      if (!confirm('与上次 ' + toJ(prev.weight) + ' 斤相差 ' + toJ(Math.abs(kg - prev.weight)) + ' 斤，确认没选错？')) return;
    }
    const r = await St.logWeight(d, kg, waist, '');
    if (r.error) { err.textContent = r.error; return; }
    guestNote(); closeSheet(); toast('已记录'); renderApp();
  }

  /* ---------- 选食材 ---------- */
  const SLOT_NAME = { b: '早餐', l: '午餐', d: '晚餐' };
  const SLOT_RATIO = { b: 0.3, l: 0.4, d: 0.3 };
  const CAT_NAME = { staple: '主食', grain: '粗粮', protein: '蛋白', veg: '蔬菜', fruit: '水果', nut: '坚果', combo: '成品' };

  function openFoodPicker(slot, mode) {
    S.mealSlot = slot;
    S.mealMode = mode || 'log';
    S.foodCat = 'all';
    S.foodScene = 'all';
    S.foodQ = '';
    S.foodResetScroll = true;
    S.mealSel = [];
    const pre = S.mealMode === 'preset' ? mealPreset(slot) : null;
    if (pre) {
      S.mealSel = pre.items.map(i => {
        const f = window.FOODS.find(x => x.name === i.name);
        return f ? f.id : null;
      }).filter(Boolean);
    }
    renderFoodSheet();
  }

  async function recordMealPreset(slot, factor) {
    const pre = mealPreset(slot);
    if (!pre) return toast('先去「我的」设置三餐预设');
    const exist = todayMeals().filter(m => m.slot === slot);
    for (const m of exist) await St.deleteMeal(m.id);

    if (factor === 0) {
      await St.addMeals(today(), slot, [{ name: SKIP_MARK, grams: 0, kcal: 0, protein: 0, fat: 0, carb: 0 }]);
      toast('记为没吃');
      renderApp();
      return;
    }

    const rows = pre.items.map(it => ({
      name: it.name,
      grams: Math.max(5, Math.round(it.grams * factor / 5) * 5),
      kcal: Math.round(it.kcal * factor),
      protein: E.round1((it.protein || 0) * factor),
      fat: E.round1((it.fat || 0) * factor),
      carb: E.round1((it.carb || 0) * factor)
    }));
    const r = await St.addMeals(today(), slot, rows);
    if (r.error) return toast(r.error);
    const total = rows.reduce((s, x) => s + x.kcal, 0);
    toast(factor > 1 ? '多吃了 ' + total + ' kcal' : factor < 1 ? '少吃了，记 ' + total + ' kcal' : '记为吃了 ' + total + ' kcal');
    renderApp();
  }

  function openMealPresetSheet() {
    const mp = extra().mealPreset || {};
    const rows = [['b', '早餐'], ['l', '午餐'], ['d', '晚餐']].map(([k, n]) => {
      const p = mp[k];
      return `<div class="item">
        <div class="item-main">
          <div class="item-name">${n}</div>
          <div class="item-meta">${p ? p.kcal + ' kcal · ' + p.items.map(i => i.name).join(' / ') : '还没设置'}</div>
        </div>
        <button class="btn btn-mini ${p ? '' : 'btn-primary'}" data-act="edit-preset-meal" data-slot="${k}">${p ? '改' : '设置'}</button>
      </div>`;
    }).join('');
    openSheet('三餐预设', `
      <div class="hint">设一次，之后每天在首页只需点「吃了 / 没吃 / 多一点 / 少一点」。</div>
      <div class="list mt12">${rows}</div>`, null);
  }

  function openDayEdit(dow) {
    S.dayEdit = { dow: Number(dow), items: (weekPlan()[dow] || []).map(x => ({ ...x })), picking: false, cat: 'chest', sub: 'all', subOpen: false };
    S.exQ = '';
    renderDayEdit();
  }

  const DOW_NAME = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const MUSCLE_CATS = [['chest', '胸'], ['back', '背'], ['legs', '腿'], ['glutes', '臀'], ['shoulders', '肩'], ['arms', '臂'], ['core', '核心'], ['full', '全身']];

  /* 二级细分：按动作名关键词归类（kw 最后一个 kw:null 的条目兜底收剩余） */
  const SUB_CATS = {
    legs: [
      { k: 'calf', n: '小腿', kw: ['小腿', '提踵', '腓肠', '比目鱼', 'calf', 'soleus'] },
      { k: 'achilles', n: '跟腱足部', kw: ['跟腱', '足底', '脚踝', '踝', 'achilles', 'plantar', 'ankle'] },
      { k: 'adductor', n: '内收外展', kw: ['内收', '外展', 'adduct', 'abduct', 'groin'] },
      { k: 'hamstring', n: '大腿后侧', kw: ['腿弯举', '腘绳', 'hamstring', 'leg curl', 'curl', '罗马尼亚', '直膝', '直腿硬拉', '早安', 'good morning', 'stiff', 'deadlift', '硬拉'] },
      { k: 'stretch', n: '拉伸放松', kw: ['拉伸', '放松', 'stretch', 'smr', '泡沫轴', 'mobility'] },
      { k: 'quad', n: '大腿前侧', kw: null }
    ],
    back: [
      { k: 'traps', n: '斜方', kw: ['耸肩', '斜方', 'shrug', 'trap'] },
      { k: 'lower', n: '下背', kw: ['背屈伸', '山羊', 'superman', '超人', 'hyperextension', 'lower back'] },
      { k: 'row', n: '划船', kw: ['划船', 'row'] },
      { k: 'lats', n: '下拉引体', kw: null }
    ],
    chest: [
      { k: 'incline', n: '上胸', kw: ['上斜', 'incline'] },
      { k: 'decline', n: '下胸', kw: ['下斜', 'decline'] },
      { k: 'fly', n: '飞鸟夹胸', kw: ['飞鸟', '夹胸', '蝶', 'fly', 'crossover', 'butterfly'] },
      { k: 'press', n: '推胸', kw: null }
    ],
    shoulders: [
      { k: 'traps', n: '斜方', kw: ['耸肩', 'shrug', '斜方'] },
      { k: 'lateral', n: '侧平举', kw: ['侧平举', 'lateral', 'side raise'] },
      { k: 'rear', n: '后束', kw: ['俯身飞鸟', '反向飞鸟', '俯身', 'rear', 'reverse'] },
      { k: 'front', n: '前平举', kw: ['前平举', 'front'] },
      { k: 'press', n: '推举', kw: null }
    ],
    arms: [
      { k: 'triceps', n: '肱三头', kw: ['三头', '臂屈伸', 'triceps', 'pushdown', 'skull', 'kickback', 'extension', 'dip'] },
      { k: 'forearm', n: '前臂', kw: ['腕', '前臂', '握', 'wrist', 'forearm', 'grip'] },
      { k: 'biceps', n: '肱二头', kw: null }
    ],
    core: [
      { k: 'obliques', n: '腹斜肌', kw: ['转体', '侧弯', '侧屈', '俄罗斯', 'twist', 'oblique', 'side bend', 'jackknife', '风车'] },
      { k: 'stability', n: '稳定深层', kw: ['平板', 'plank', '死虫', 'dead bug', '鸟狗', 'bird', '真空', 'vacuum', 'hollow', '帕洛夫', 'pallof'] },
      { k: 'lowerback', n: '下背', kw: ['背屈伸', '山羊', 'superman', 'lower back'] },
      { k: 'legraise', n: '抬腿类', kw: ['举腿', '抬腿', 'leg raise', 'hanging', '悬挂', '收腹'] },
      { k: 'abs', n: '腹直肌', kw: null }
    ],
    full: [
      { k: 'plyo', n: '爆发燃脂', kw: ['波比', 'burpee', '开合跳', 'jumping jack', '高抬腿', 'high knee', '跳箱', 'box jump', '深蹲跳', 'squat jump', '箭步跳', '跳跃', '立卧', '登山者', 'mountain', '熊爬', 'bear'] },
      { k: 'cardio', n: '有氧', kw: ['跑', '步', '单车', '骑行', '跳绳', '游泳', '椭圆', '划船机', '爬楼', '健走', '远足', '轮滑', '滑板', '球', '拳', '操', 'run', 'jog', 'bike', 'cycl', 'rope', 'swim', 'elliptical', 'stair', 'treadmill', 'hike', 'skat', 'row', 'badminton'] },
      { k: 'mind', n: '身心拉伸', kw: ['瑜伽', '普拉提', '拉伸', '冥想', '放松', '泡沫轴', 'yoga', 'pilat', 'stretch', 'smr'] },
      { k: 'strength', n: '全身力量', kw: null }
    ]
  };
  function exSubOf(e) {
    const subs = SUB_CATS[e.muscle];
    if (!subs) return '';
    const hay = (e.name + ' ' + (e.en || '')).toLowerCase();
    for (const s of subs) {
      if (!s.kw) return s.k;
      if (s.kw.some(k => hay.indexOf(k) >= 0)) return s.k;
    }
    return subs[subs.length - 1].k;
  }
  function exSubsHtml() {
    const st = S.dayEdit;
    const subs = SUB_CATS[st.cat];
    if (!subs) return '';
    const blk = new Set(blockedNames('blocked_ex'));
    const pool = window.EXERCISES.filter(e => e.muscle === st.cat && !blk.has(e.name));
    const cnt = {};
    pool.forEach(e => { const k = exSubOf(e); cnt[k] = (cnt[k] || 0) + 1; });
    const cur = st.sub || 'all';
    const chip = (v, n, c) => `<button class="sub-chip ${cur === v ? 'on' : ''}" data-act="day-sub" data-v="${v}">${n}<em>${c}</em></button>`;
    let html = chip('all', '全部', pool.length);
    html += subs.map(s => cnt[s.k] ? chip(s.k, s.n, cnt[s.k]) : '').join('');
    return html;
  }
  /* 细分标签超过一行时显示展开/收起按钮 */
  function layoutSubChips() {
    const chips = document.getElementById('ex-subs');
    const btn = document.getElementById('ex-sub-toggle');
    if (!chips || !btn) return;
    const first = chips.querySelector('.sub-chip');
    const oneLine = first ? first.offsetHeight : 28;
    const need = chips.scrollHeight > oneLine + 2;
    btn.classList.toggle('show', need);
    if (need) {
      chips.style.maxHeight = S.dayEdit.subOpen ? 'none' : oneLine + 'px';
      chips.classList.toggle('collapsed', !S.dayEdit.subOpen);
    } else {
      chips.style.maxHeight = 'none';
      chips.classList.remove('collapsed');
    }
    btn.textContent = S.dayEdit.subOpen ? '▴' : '▾';
  }


  function exFilterOpts() {
    const cp = calcProfile();
    return { equipment: cp.equipment || ['none'], limitations: cp.limitations || [], blacklist: blockedNames('blocked_ex') };
  }

  function exPool() {
    const st = S.dayEdit;
    const q = (S.exQ || '').trim();
    const cp = calcProfile();
    const opts = exFilterOpts();
    const blk = new Set(blockedNames('blocked_ex'));
    let list = window.EXERCISES.filter(e => e.muscle === st.cat && !blk.has(e.name));
    if (st.sub && st.sub !== 'all') list = list.filter(e => exSubOf(e) === st.sub);
    if (q) list = list.filter(e => e.name.indexOf(q) >= 0 || (e.en && e.en.toLowerCase().indexOf(q.toLowerCase()) >= 0));
    // 默认按「训练条件」（器械 + 身体限制）过滤；点「显示全部」临时放开
    if (!S.exShowAll) {
      list = list.filter(e => E.exerciseAllowed(e, { equipment: opts.equipment, limitations: opts.limitations, blacklist: [] }));
      // 女性用户：高阶（level 3）动作排到后面，不硬过滤
      if (cp.gender === 'female') {
        list = [...list.filter(e => e.level < 3), ...list.filter(e => e.level >= 3)];
      }
    }
    return list;
  }

  /* 动作库被器械条件过滤掉了多少个（用于提示行） */
  function exFilteredCount() {
    const st = S.dayEdit;
    const opts = exFilterOpts();
    const blk = new Set(blockedNames('blocked_ex'));
    const total = window.EXERCISES.filter(e => e.muscle === st.cat && !blk.has(e.name));
    return total.length - total.filter(e => E.exerciseAllowed(e, { equipment: opts.equipment, limitations: opts.limitations, blacklist: [] })).length;
  }

  /* 动作示范图：优先云数据库 bm_ex_media（base64），失败回退本地 assets/ex，再回退 CDN 镜像 */
  const EX_CDN_BASE = [
    'https://gcore.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/',
    'https://testingcf.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/'
  ];
  const exMediaCache = {};
  const exDescCache = {};
  async function fetchExDesc(exId) {
    if (exDescCache[exId]) return exDescCache[exId];
    // 云数据库优先（bm_ex_desc），失败回退本地 ex-desc.js
    let zh = '';
    try {
      const db = St.cloud && St.cloud.database;
      if (db) {
        const { data, error } = await db.from('bm_ex_desc').select('zh').eq('id', exId).limit(1);
        if (!error && Array.isArray(data) && data.length && data[0].zh) zh = data[0].zh;
      }
    } catch (err) { /* 云端取不到就用本地 */ }
    if (!zh && window.EX_DESC && window.EX_DESC[exId]) zh = window.EX_DESC[exId];
    exDescCache[exId] = zh;
    return zh;
  }
  async function fetchExMedia(exId) {
    if (exMediaCache[exId] !== undefined) return exMediaCache[exId];
    let urls = (window.EX_MEDIA && window.EX_MEDIA[exId]) || [];
    try {
      const db = St.cloud && St.cloud.database;
      if (db) {
        const { data, error } = await db.from('bm_ex_media')
          .select('id,mime,data')
          .like('id', exId + '-%');
        if (!error && Array.isArray(data) && data.length) {
          urls = data
            .sort((a, b) => a.id < b.id ? -1 : 1)
            .map(r => 'data:' + r.mime + ';base64,' + r.data);
        }
      }
    } catch (err) { /* 云端取不到就用本地文件 */ }
    // 本地也没有 → 尝试 CDN（扩充库动作的示范图），主镜像不通时前端会换下一个
    if (!urls.length && window.EX_CDN && window.EX_CDN[exId]) {
      urls = window.EX_CDN[exId].map(p => EX_CDN_BASE[0] + p);
    }
    exMediaCache[exId] = urls;
    return urls;
  }

  async function openExDetail(name, opt) {
    const e = window.EXERCISES.find(x => x.name === name);
    if (!e) return;
    // 已有弹层时（如动作选择界面），压栈保存，关闭示范后原样恢复
    const root = $('#sheet-root');
    if (root.innerHTML.trim()) {
      const curBody = root.querySelector('.sheet-body');
      S.sheetStack = S.sheetStack || [];
      S.sheetStack.push({ html: root.innerHTML, scroll: curBody ? curBody.scrollTop : 0 });
    }
    const cp = calcProfile();
    const kcal = E.kcalOf(e.met, cp.weight, 20);
    const muscleName = (MUSCLE_CATS.find(m => m[0] === e.muscle) || ['', ''])[1] || '全身';
    const media = await fetchExMedia(e.id);
    const imgs = media.map(src => `<img class="ex-media-img" src="${src}" alt="${esc(e.name)} 示范" loading="lazy" />`).join('');
    const mediaCap = media.length >= 2 ? '上图为起始姿势，下图为完成姿势' : '动作示范';
    const mediaHtml = imgs
      ? `<div class="ex-media">${imgs}<div class="hint" style="text-align:center">${mediaCap}</div></div>`
      : `<div class="empty">这个动作暂无示范图，可以照下面的步骤做</div>`;
    const desc = await fetchExDesc(e.id);
    const steps = desc
      ? desc.split('。').map(s => s.trim()).filter(s => s.length > 3)
      : [];
    const stepsHtml = steps.length
      ? `<div class="ex-steps"><div class="ex-steps-t">动作步骤<span class="hint">共 ${steps.length} 步</span></div><ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>`
      : '';
    const body = `
      ${mediaHtml}
      ${stepsHtml}
      <div class="kv" style="margin-top:12px">
        <div class="kv-row"><span>部位</span><b>${muscleName}</b></div>
        <div class="kv-row"><span>器械</span><b>${EQUIP_NAME[e.equip] || '徒手'}</b></div>
        <div class="kv-row"><span>强度参考</span><b>${e.unit === 'min' ? '约 ' + Math.round(kcal) + ' kcal / 20 分钟' : '每组约 ' + Math.round(kcal / 3) + ' kcal，常规 3 组'}</b></div>
      </div>
      ${e.tip ? `<div class="notice green" style="margin-top:10px">要点：${esc(e.tip)}</div>` : ''}
      ${cp.gender === 'female' && e.level >= 3 && e.impact === 'high' ? '<div class="notice" style="margin-top:10px">这个动作强度较高、对膝盖冲击较大，女生建议先从同类低冲击版本练起。</div>' : ''}
      ${media.length ? '' : `<div class="hint mt8">也可以把动作名复制到视频网站搜索，跟随示范学习。</div>`}`;
    const foot = opt && opt.lib
      ? `<div class="row" style="gap:10px">
          <button class="btn" data-act="close-sheet" style="flex:0 0 96px">返回</button>
          <button class="btn btn-primary grow" data-act="lib-add-today" data-name="${esc(e.name)}" data-met="${e.met}">加入今日训练</button>
        </div>`
      : '';
    openSheet(e.name, body, foot);
    // 示范图加载失败时优雅降级：CDN 换镜像 → 隐藏破图 → 全部失败给文字提示
    const mediaBox = document.querySelector('#sheet-root .ex-media');
    if (mediaBox) {
      const imgs = [...mediaBox.querySelectorAll('img')];
      let failed = 0;
      imgs.forEach(img => {
        img.addEventListener('error', () => {
          const src = img.getAttribute('src') || '';
          if (src.startsWith(EX_CDN_BASE[0])) {
            img.setAttribute('src', src.replace(EX_CDN_BASE[0], EX_CDN_BASE[1]));
            return;
          }
          img.style.display = 'none';
          failed++;
          if (failed === imgs.length) {
            mediaBox.innerHTML = '<div class="empty">示范图加载失败，可以照下面的步骤做，或把动作名复制到视频网站搜索。</div>';
          }
        });
      });
    }
  }

  function exGridHtml() {
    const st = S.dayEdit;
    const cp = calcProfile();
    const list = exPool();
    const added = new Set(st.items.map(i => i.n));
    const fem = cp.gender === 'female';
    if (!list.length) return '<div class="empty">这个部位没有符合你条件的动作，可点上方「显示全部」查看</div>';
    return list.map(e => {
      const on = added.has(e.name);
      const kcal = E.kcalOf(e.met, cp.weight, 20);
      const sub = e.unit === 'min' ? '20 分钟' : '3 组';
      const hasMedia = (window.EX_MEDIA && window.EX_MEDIA[e.id]) || (window.EX_CDN && window.EX_CDN[e.id]);
      const hard = fem && e.level >= 3;
      return `<div class="food-cell ${on ? 'on' : ''} ${hard ? 'is-hard' : ''}" data-act="ex-detail" data-name="${esc(e.name)}">
          <span class="fn">${esc(e.name)}${hard ? ' <span class="pill pill-warn">偏难</span>' : ''}</span>
          <span class="fc">${EQUIP_NAME[e.equip] || '徒手'}${hasMedia ? ' · 📷有示范' : ''}</span>
          <span class="fc">${sub} · 约 ${kcal} kcal</span>
          <button class="food-add" data-act="day-toggle" data-name="${esc(e.name)}">${on ? '✓' : '+'}</button>
        </div>`;
    }).join('');
  }

  function dayListHtml() {
    const st = S.dayEdit;
    if (!st.items.length) return '<div class="empty">这天还没有动作，点下面添加</div>';
    return st.items.map((it, i) => `
      <div class="item">
        <div class="item-main">
          <div class="item-name" data-act="ex-detail" data-name="${esc(it.n)}" style="text-decoration:underline dotted;cursor:pointer">${esc(it.n)}</div>
          <div class="item-meta">${it.min ? it.min + ' 分钟' : (it.sets || 3) + ' 组 × ' + (it.reps || '12')}</div>
        </div>
        <button class="btn btn-mini btn-danger" data-act="day-del" data-i="${i}">删</button>
      </div>`).join('');
  }

  function renderDayEdit() {
    const st = S.dayEdit;
    if (st.picking) {
      const blkSet = new Set(blockedNames('blocked_ex'));
      const opts0 = exFilterOpts();
      const allowOf = e => S.exShowAll || E.exerciseAllowed(e, { equipment: opts0.equipment, limitations: opts0.limitations, blacklist: [] });
      const cntOf = k => window.EXERCISES.filter(e => e.muscle === k && !blkSet.has(e.name) && allowOf(e)).length;
      const filtered = exFilteredCount();
      openSheet(DOW_NAME[st.dow - 1] + ' · 添加动作', `
        <div class="fs-head">
          <div class="between">
            <div><b style="font-size:15px">${DOW_NAME[st.dow - 1]}</b>
              <span class="hint" id="ex-count">已选 ${st.items.length} 个</span></div>
            <span class="hint">点卡片看示范 · 点 + 加入</span>
          </div>
          <input class="input" id="ex-search" placeholder="搜动作：深蹲、卧推、跑步…" value="${esc(S.exQ || '')}" />
          <div class="ex-filter-row">
            <span class="hint">${S.exShowAll ? '正在显示全部动作' : '已按你的器械条件过滤' + (filtered ? '（隐藏 ' + filtered + ' 个）' : '')}${calcProfile().gender === 'female' && !S.exShowAll ? ' · 高阶动作排后' : ''}</span>
            <button class="btn btn-mini" data-act="ex-showall">${S.exShowAll ? '只看可用' : '显示全部'}</button>
          </div>
        </div>
        <div class="fs-main">
          <aside class="side-cats">
            ${MUSCLE_CATS.map(([k, n]) => `<button class="side-cat ${st.cat === k ? 'on' : ''}" data-act="day-cat" data-v="${k}">
              <span>${n}</span><em>${cntOf(k)}</em></button>`).join('')}
          </aside>
          <div class="fs-right">
            <div class="sub-row">
              <div class="sub-chips" id="ex-subs">${exSubsHtml()}</div>
              <button class="sub-toggle" id="ex-sub-toggle" data-act="day-sub-toggle" title="展开/收起细分">▾</button>
            </div>
            <div class="fs-grid" id="ex-grid">${exGridHtml()}</div>
          </div>
        </div>`,
        `<button class="btn btn-primary btn-block" data-act="day-done">完成（已选 ${st.items.length} 个）</button>`,
        'food-sheet-body', 'food-sheet-fixed');
      layoutSubChips();
      return;
    }

    openSheet(DOW_NAME[st.dow - 1] + '的计划', `
      <div class="day-list" id="day-list">${dayListHtml()}</div>
      <div class="day-foot"><button class="btn btn-block" data-act="day-pick">＋ 添加动作</button></div>`,
      `<div class="row" style="gap:10px">
        <button class="btn" data-act="close-sheet" style="flex:0 0 96px">取消</button>
        <button class="btn btn-primary grow" data-act="day-save">保存</button>
      </div>`, 'day-plan-body', 'food-sheet-fixed');
  }


  function slotTargetKcal() {
    const pl = E.progress(weights(), calcProfile()).plan;
    return Math.round(pl.targetIntake * SLOT_RATIO[S.mealSlot]);
  }

  function foodPool() {
    const cp = calcProfile();
    const opts = { avoid: cp.dislikes || [], diet: cp.dietStyle || 'normal' };
    const blocked = blockedNames('blocked_food');
    const custom = St.listCustom('custom_food').filter(c => !(c.payload && c.payload.blocked))
      .map(c => ({ id: c.id, name: c.name, cat: c.payload.cat || 'protein', kcal: c.payload.kcal || 100, p: c.payload.p || 0, f: c.payload.f || 0, c: c.payload.c || 0, unit: c.payload.unit || '一份', g: c.payload.g || 100, slots: c.payload.slots || ['b', 'l', 'd'], scene: 'any', tags: [] }));
    const all = [...custom, ...window.FOODS].filter(f =>
      (!f.slots || f.slots.includes(S.mealSlot)) && !blocked.includes(f.name) && E.foodAllowed(f, opts)
    );
    if (S.foodScene !== 'all') return all.filter(f => f.scene === S.foodScene || f.scene === 'any');
    return all;
  }

  function foodListFor() {
    const pool = foodPool();
    const q = (S.foodQ || '').trim();
    let list = S.foodCat === 'all' ? pool.slice() : pool.filter(f => f.cat === S.foodCat);
    if (q) list = list.filter(f => f.name.indexOf(q) >= 0);
    return list;
  }

  function foodGridHtml() {
    const list = foodListFor();
    if (!list.length) return '<div class="empty">没有匹配的食材，换个词试试，或者自己加一个</div>';
    return list.map(f => {
      const on = S.mealSel.some(id => String(id) === String(f.id));
      const h = f.hand || { u: '份', g: f.g || 100 };
      const kcalPer = Math.round(f.kcal * h.g / 100);
      return `<div class="food-cell ${on ? 'on' : ''}" data-id="${f.id}">
          <span class="fn">${esc(f.name)}</span>
          <span class="fc">一${h.u} ≈ ${h.g}g</span>
          <span class="fc">${kcalPer} kcal</span>
          <button class="food-add" data-act="food-toggle" data-id="${f.id}" aria-label="添加">${on ? '✓' : '+'}</button>
        </div>`;
    }).join('');
  }

  function foodResult() {
    const pool = foodPool();
    const selected = S.mealSel.map(id => pool.find(f => String(f.id) === String(id))).filter(Boolean);
    return E.portion(selected, slotTargetKcal(), S.mealSlot);
  }

  function calcBarInner(r) {
    const target = r.target;
    return `
      <div class="between">
        <span class="calc-total">配好总量 <b>${r.total}</b> kcal <span class="hint">/ ${target}</span></span>
        <button class="btn btn-mini" data-act="custom-food">＋ 自定义</button>
      </div>
      <div class="calc-list">
        ${r.items.length
        ? r.items.map(i => `${esc(i.name)} <b>约${i.qty}${i.hand ? i.hand.u : '份'}</b>（${i.grams}g · ${i.kcal}kcal）`).join('　')
        : '左边选分类，右边点食材，这里会给建议克数'}
      </div>
      ${r.items.length ? `<div class="hint" style="margin-top:6px">
        蛋白 ${E.round1(r.items.reduce((s, i) => s + (i.protein || 0), 0))}g ·
        脂肪 ${E.round1(r.items.reduce((s, i) => s + (i.fat || 0), 0))}g ·
        碳水 ${E.round1(r.items.reduce((s, i) => s + (i.carb || 0), 0))}g
        ${Math.abs(r.diff) > target * 0.12 ? ' · 比目标' + (r.diff > 0 ? '多' : '少') + Math.abs(Math.round(r.diff)) + ' kcal' : ''}
      </div>` : ''}
      ${r.isCombo && S.mealSel.length > 1 ? '<div class="hint" style="color:#b45309;margin-top:4px">成品按整份算，同时选的其他食材会被忽略</div>' : ''}`;
  }

  function updateFoodCalc() {
    const r = foodResult();
    const bar = document.getElementById('food-calc');
    if (bar) bar.innerHTML = calcBarInner(r);
    const btn = document.getElementById('food-save');
    if (btn) {
      btn.disabled = !r.items.length;
      btn.textContent = (S.mealMode === 'preset' ? '保存为预设' : '按这份吃') + '（' + r.total + ' kcal）';
    }
    const cnt = document.getElementById('food-count');
    if (cnt) cnt.textContent = '已选 ' + S.mealSel.length + ' 种';
  }

  function setFoodCat(cat) {
    S.foodCat = cat;
    document.querySelectorAll('.side-cat').forEach(b => b.classList.toggle('on', b.dataset.v === cat));
    const g = document.getElementById('food-grid');
    if (g) { g.innerHTML = foodGridHtml(); g.scrollTop = 0; }
  }

  function setFoodScene(sc) {
    S.foodScene = sc;
    document.querySelectorAll('[data-act="food-scene"]').forEach(b => b.classList.toggle('on', b.dataset.v === sc));
    const g = document.getElementById('food-grid');
    if (g) { g.innerHTML = foodGridHtml(); g.scrollTop = 0; }
  }

  function renderFoodSheet() {
    const target = slotTargetKcal();
    const pool = foodPool();
    const r = foodResult();
    const cats = ['all', 'staple', 'grain', 'protein', 'veg', 'fruit', 'nut', 'combo'];
    const counts = { all: pool.length };
    pool.forEach(f => { counts[f.cat] = (counts[f.cat] || 0) + 1; });
    const scenes = [['all', '不限'], ['home', '自己做'], ['canteen', '食堂'], ['takeout', '外卖']];
    const catName = { all: '全部', staple: '主食', grain: '粗粮', protein: '蛋白', veg: '蔬菜', fruit: '水果', nut: '坚果', combo: '成品' };

    const body = `
      <div class="fs-head">
        <div class="between">
          <div><b style="font-size:15px">${SLOT_NAME[S.mealSlot]}</b>
            <span class="hint">目标 ${target} kcal</span></div>
          <span class="hint" id="food-count">已选 ${S.mealSel.length} 种</span>
        </div>
        <input class="input" id="food-search" placeholder="搜食材：玉米、鸡蛋、苹果…" value="${esc(S.foodQ || '')}" />
        <div class="chips" style="margin-top:8px">
          ${scenes.map(([k, n]) => `<button class="chip chip-sm ${S.foodScene === k ? 'on' : ''}" data-act="food-scene" data-v="${k}">${n}</button>`).join('')}
        </div>
      </div>
      <div class="fs-main">
        <aside class="side-cats">
          ${cats.map(c => `<button class="side-cat ${S.foodCat === c ? 'on' : ''}" data-act="food-cat" data-v="${c}">
            <span>${catName[c]}</span><em>${counts[c] || 0}</em></button>`).join('')}
        </aside>
        <div class="fs-grid" id="food-grid">${foodGridHtml()}</div>
      </div>
      <div class="calc-bar" id="food-calc">${calcBarInner(r)}</div>`;

    const isPreset = S.mealMode === 'preset';
    openSheet(isPreset ? '设定' + SLOT_NAME[S.mealSlot] + '吃什么' : '选今天吃什么', body,
      `<div class="row" style="gap:10px">
        <button class="btn" data-act="close-sheet" style="flex:0 0 96px">取消</button>
        <button class="btn btn-primary grow" id="food-save" data-act="save-meal" ${r.items.length ? '' : 'disabled'}>
          ${isPreset ? '保存为预设' : '按这份吃'}（${r.total} kcal）</button>
      </div>`, 'food-sheet-body', 'food-sheet-fixed');
  }

  async function saveMeal() {
    const pool = foodPool();
    const selected = S.mealSel.map(id => pool.find(f => String(f.id) === String(id))).filter(Boolean);
    const target = slotTargetKcal();
    const result = E.portion(selected, target, S.mealSlot);
    if (!result.items.length) return toast('还没选食材');

    if (S.mealMode === 'preset') {
      const mp = { ...(extra().mealPreset || {}) };
      mp[S.mealSlot] = {
        kcal: result.total,
        items: result.items.map(i => ({
          name: i.name, grams: i.grams, kcal: i.kcal,
          protein: i.protein, fat: i.fat, carb: i.carb
        }))
      };
      const r = await saveExtra({ mealPreset: mp });
      if (r.error) return toast(r.error);
      closeSheet();
      toast(SLOT_NAME[S.mealSlot] + '预设已保存');
      renderApp();
      return;
    }

    const rows = result.items.map(i => ({
      name: i.name, grams: i.grams, kcal: i.kcal,
      protein: i.protein, fat: i.fat, carb: i.carb
    }));
    const r = await St.addMeals(today(), S.mealSlot, rows);
    if (r.error) { toast(r.error); return; }
    closeSheet();
    toast('已记入' + SLOT_NAME[S.mealSlot]);
    renderApp();
  }

  /* ---------- 换动作 ---------- */
  function openSwap(name, muscle) {
    const cp = calcProfile();
    const eq = cp.equipment || ['none'];
    const black = blockedNames('blocked_ex');
    const fem = cp.gender === 'female';
    let cands = window.EXERCISES.filter(e =>
      e.muscle === muscle && !black.includes(e.name) && e.name !== name &&
      E.hasMedia(e.name) &&
      (e.equip === 'none' || eq.includes(e.equip))
    );
    // 女性：高阶动作排后
    if (fem) cands = [...cands.filter(e => e.level < 3), ...cands.filter(e => e.level >= 3)];
    cands = cands.slice(0, 12);

    const body = `<div class="hint" style="margin-bottom:12px">
      和「${esc(name)}」练同一部位、且你现有条件能做到的动作。换掉只影响今天。
    </div>
    <div class="list">${cands.map(e => `
      <div class="item">
        <div class="item-main">
          <div class="item-name">${esc(e.name)}${fem && e.level >= 3 ? ' <span class="pill pill-warn">偏难</span>' : ''}</div>
          <div class="item-meta">${e.equip === 'none' ? '徒手' : EQUIP_NAME[e.equip] || e.equip} ·
            强度 MET ${e.met} · 约 ${E.kcalOf(e.met, cp.weight, 15)} kcal/15 分钟</div>
        </div>
        <button class="btn btn-mini btn-primary" data-act="pick-swap" data-name="${esc(e.name)}" data-met="${e.met}">选它</button>
      </div>`).join('') || '<div class="empty">没有合适的替代，试试下面的自定义</div>'}</div>
    <button class="btn btn-block mt12" data-act="custom-ex">＋ 自己填一个</button>`;

    openSheet('换个动作', body);
  }

  function openCustomEx() {
    const body = `
      <div class="field"><label>练了什么</label>
        <input class="input" id="cx-name" placeholder="例如：操场慢跑、公司健身房椭圆机" /></div>
      <div class="field"><label>时长（分钟）</label>
        <input class="input" id="cx-min" type="number" inputmode="numeric" value="30" /></div>
      <div class="field"><label>强度</label>
        <div class="seg seg-block">
          <button class="seg-item active" data-act="cx-level" data-v="3">轻松</button>
          <button class="seg-item" data-act="cx-level" data-v="6">中等</button>
          <button class="seg-item" data-act="cx-level" data-v="9">很累</button>
        </div>
      </div>
      <div class="hint">强度会换算成消耗热量，粗略但够用。</div>
      <div class="err" id="cx-err"></div>`;
    S.cxLevel = 3;
    openSheet('记录自定义训练', body,
      `<button class="btn btn-primary btn-block" data-act="save-custom-ex">保存并计入今日</button>`);
  }

  async function saveCustomEx() {
    const name = ($('#cx-name') || {}).value || '';
    const min = Number(($('#cx-min') || {}).value) || 30;
    const met = S.cxLevel || 3;
    if (!name.trim()) return ($('#cx-err').textContent = '写个名字');
    const cp = calcProfile();
    const kcal = E.kcalOf(met, cp.weight, min);
    const r1 = await St.addWorkout(today(), name.trim(), min, kcal);
    if (r1.error) return ($('#cx-err').textContent = r1.error);
    await St.saveCustom('custom_ex', name.trim(), { met, min });
    guestNote(); closeSheet(); toast('已记录 ' + kcal + ' kcal'); renderApp();
  }

  /* ---------- 自定义食物 ---------- */
  function openCustomFood() {
    const body = `
      <div class="field"><label>名称</label>
        <input class="input" id="cf-name" placeholder="例如：妈妈做的红烧排骨" /></div>
      <div class="field"><label>类型</label>
        <div class="chips">
          ${['staple', 'protein', 'veg', 'fruit', 'nut'].map((c, i) =>
      `<button class="chip ${i === 1 ? 'on' : ''}" data-act="cf-cat" data-v="${c}">${CAT_NAME[c]}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>热量（每 100g，kcal）</label>
        <input class="input" id="cf-kcal" type="number" inputmode="decimal" placeholder="例如 250" /></div>
      <div class="field"><label>一份大约多少克</label>
        <input class="input" id="cf-g" type="number" inputmode="numeric" value="150" /></div>
      <div class="hint">不知道热量就填个大概，估总比不记强。</div>
      <div class="err" id="cf-err"></div>`;
    S.cfCat = 'protein';
    openSheet('添加自定义食物', body,
      `<button class="btn btn-primary btn-block" data-act="save-custom-food">保存到我的食材库</button>`);
  }

  async function saveCustomFood() {
    const name = ($('#cf-name') || {}).value || '';
    const kcal = Number(($('#cf-kcal') || {}).value);
    const g = Number(($('#cf-g') || {}).value) || 150;
    if (!name.trim()) return ($('#cf-err').textContent = '写个名字');
    if (!(kcal > 0 && kcal < 900)) return ($('#cf-err').textContent = '热量填得不太对');
    const r = await St.saveCustom('custom_food', name.trim(), {
      cat: S.cfCat || 'protein', kcal, g, unit: '一份', slots: ['b', 'l', 'd', 's']
    });
    if (r.error) return ($('#cf-err').textContent = r.error);
    closeSheet(); toast('已加入食材库'); renderFoodSheet();
  }

  /* ---------- 设置类 ---------- */
  function openGoalEdit() {
    const cp = calcProfile();
    S.gCur = toJ(cp.weight);
    S.gTarget = toJ(cp.targetWeight || cp.weight);
    S.gDate = cp.targetDate || E.addDays(today(), 90);
    renderGoalSheet();
  }

  function renderGoalSheet() {
    const cp = calcProfile();
    openSheet('修改目标', `
      <div class="field"><label>起始体重</label>
        <button class="field-pick" data-act="g-pick-cur">
          <span><span class="v">${S.gCur}</span><span class="u">斤</span></span>
          <span class="ar">滑动选择 ›</span>
        </button>
      </div>
      <div class="field"><label>预期体重</label>
        <button class="field-pick" data-act="g-pick-target">
          <span><span class="v">${S.gTarget}</span><span class="u">斤</span></span>
          <span class="ar">滑动选择 ›</span>
        </button>
      </div>
      <div class="field"><label>预期达成日期</label>
        <button class="field-pick" data-act="g-pick-date">
          <span><span class="v">${S.gDate.replace(/-/g, '/')}</span>
            <span class="u">${E.daysBetween(today(), S.gDate)} 天后</span></span>
          <span class="ar">滑动选择 ›</span>
        </button>
      </div>
      <div class="field"><label>日常活动量（不含训练）</label>
        <select class="input" id="g-activity">
          <option value="sedentary" ${cp.activity === 'sedentary' ? 'selected' : ''}>基本不动 · 办公室久坐</option>
          <option value="light" ${cp.activity === 'light' ? 'selected' : ''}>偶尔走动 · 少量站立</option>
          <option value="moderate" ${cp.activity === 'moderate' ? 'selected' : ''}>经常走动 · 站立型工作</option>
          <option value="active" ${cp.activity === 'active' ? 'selected' : ''}>大量走动 · 体力劳动</option>
        </select>
        <div class="hint">只算工作、通勤、家务这类日常走动，训练消耗另外计算。</div>
      </div>
      <div class="hint" style="margin-top:-4px">起始体重是进度的零点，曲线和完成度都从它算起。</div>
      <div id="g-preview" class="notice green" style="display:none"></div>
      <div class="hint mt12">改目标不会删除已有记录，曲线会按新目标重算。</div>`,
      `<button class="btn btn-primary btn-block" data-act="save-goal">保存</button>`);
    previewGoal();
  }

  function previewGoal() {
    const box = $('#g-preview');
    if (!box) return;
    const cp = calcProfile();
    const cur = toKg(S.gCur);
    const tw = toKg(S.gTarget);
    const pl = E.plan({
      ...cp, weight: cur, startWeight: cp.startWeight || cur,
      targetWeight: tw, startDate: cp.startDate || today(), targetDate: S.gDate
    });
    const diffJ = Math.abs(E.round1(S.gCur - S.gTarget));
    const weeks = Math.max(1, Math.round(E.daysBetween(today(), S.gDate) / 7));
    box.style.display = 'block';
    box.innerHTML = `目标：<b>${S.gCur} 斤</b> → <b>${S.gTarget} 斤</b>
      （${pl.dir === 'cut' ? '减' : pl.dir === 'bulk' ? '增' : '维持'} ${diffJ} 斤 / 约 ${weeks} 周）<br/>
      每天需要 <b>${pl.deficit}</b> kcal 的${pl.dir === 'cut' ? '缺口' : '盈余'}，目标摄入约 <b>${pl.targetIntake}</b> kcal。
      ${pl.tooFast ? '<br/>⚠️ 期限偏紧，按健康速率建议 ' + pl.suggestDate : ''}`;
  }

  async function saveGoal() {
    const sel = $('#g-activity');
    const cp = calcProfile();
    const act = sel ? sel.value : (cp.activity || 'light');
    const cur = toKg(S.gCur);
    const tw = toKg(S.gTarget);
    if (!(tw > 25 && tw < 300)) return toast('目标体重选得不太对');
    if (E.daysBetween(today(), S.gDate) < 1) return toast('日期要晚于今天');
    const goalType = tw < cur ? 'cut' : (tw > cur ? 'bulk' : 'maintain');
    const startIso = cp.startDate || today();
    const r = await St.saveProfile({
      startWeight: cur,
      startDate: startIso,
      targetWeight: tw,
      targetDate: S.gDate,
      activity: act,
      goalType
    });
    if (r.error) return toast(r.error);
    try { localStorage.removeItem('bm_warn_dismissed'); } catch (err) {}
    const lw = lastWeight();
    if (cur && (!lw || Math.abs(cur - lw.weight) > 0.05)) {
      await St.logWeight(today(), cur, null, '更新起始体重');
    }
    guestNote(); closeSheet(); toast('目标已更新'); renderApp();
  }

  function openEquipEdit() {
    const cp = calcProfile();
    const eqList = Object.keys(EQUIP_NAME);
    const limList = Object.keys(LIM_NAME);
    const sel = new Set(cp.equipment || ['none']);
    const lim = new Set(cp.limitations || []);
    const body = `
      <div class="field"><label>器械 / 场地</label>
        <div class="chips">${eqList.map(k => `<button class="chip ${sel.has(k) ? 'on' : ''}" data-act="eq-toggle" data-v="${k}">${EQUIP_NAME[k]}</button>`).join('')}</div>
      </div>
      <div class="field" style="margin-top:16px"><label>身体限制</label>
        <div class="chips">${limList.map(k => `<button class="chip ${lim.has(k) ? 'on' : ''}" data-act="lim-toggle" data-v="${k}">${LIM_NAME[k]}</button>`).join('')}</div>
      </div>
      <div class="hint">改完后推荐会立刻按新条件过滤，做不了的动作不会再出现。</div>`;
    S.eqSel = sel; S.limSel = lim;
    openSheet('训练条件', body,
      `<button class="btn btn-primary btn-block" data-act="save-equip">保存</button>`);
  }

  function openDietEdit() {
    const cp = calcProfile();
    const dis = new Set(cp.dislikes || []);
    const body = `
      <div class="field"><label>饮食方式</label>
        <div class="chips">${window.DIET_STYLES.map(d =>
      `<button class="chip ${cp.dietStyle === d.id ? 'on' : ''}" data-act="diet-set" data-v="${d.id}">${d.name}</button>`).join('')}</div>
        <div class="hint mt8">${(window.DIET_STYLES.find(d => d.id === cp.dietStyle) || {}).desc || ''}</div>
      </div>
      <div class="field" style="margin-top:16px"><label>忌口 / 不吃</label>
        <div class="chips">${window.AVOID_TAGS.map(t =>
      `<button class="chip ${dis.has(t) ? 'on' : ''}" data-act="avoid-toggle" data-v="${t}">${t}</button>`).join('')}</div>
      </div>`;
    S.disSel = dis; S.dietSel = cp.dietStyle || 'normal';
    openSheet('饮食偏好', body,
      `<button class="btn btn-primary btn-block" data-act="save-diet">保存</button>`);
  }

  async function openChoosePlan() {
    const cp = calcProfile();
    const eq = cp.equipment || ['none'];
    const body = `<div class="hint" style="margin-bottom:12px">按你勾选的器械条件，下面标了「可用 / 缺器械」。</div>
      <div class="list">${window.PLAN_TEMPLATES.map(t => {
      const ready = t.equip.every(x => eq.includes(x));
      return `<div class="item">
          <div class="item-main">
            <div class="item-name">${esc(t.name)} ${ready ? '' : '<span class="pill pill-warn">缺器械</span>'}</div>
            <div class="item-meta">${t.desc}</div>
            <div class="item-meta">${t.place === 'gym' ? '健身房' : t.place === 'home' ? '居家' : '户外'} · 按周 ${t.daysPerWeek} 天 / 按月 ${t.daysPerMonth} 次 · 需 ${t.equip.map(x => EQUIP_NAME[x]).join('/')}</div>
          </div>
          <button class="btn btn-mini ${ready ? 'btn-primary' : ''}" data-act="pick-plan" data-v="${t.id}">选</button>
        </div>`;
    }).join('')}</div>`;
    openSheet('选择训练方案', body);
  }

  /* ============ 事件 ============ */
  const handlers = {
    'auth-tab': d => { S.authTab = d.tab; renderAuth(); },
    'acct-type': d => { S.acctType = d.type; renderAuth(); },
    'send-code': () => sendCode(),
    'do-login': () => doLogin(),
    'do-register': () => doRegister(),
    'forgot': () => openForgot(),
    'fg-type': d => { S.fg.type = d.type; S.fg.step = 1; S.fg.remain = 0; renderForgot(); },
    'fg-send': () => fgSend(),
    'fg-reset': () => fgReset(),
    'fg-verify-login': () => fgVerifyLogin(),
    'pwd-edit': () => openChangePwd(),
    'pwd-save': () => saveChangePwd(),

    /* 游客模式：注册引导 / 返回体验 */
    'guest-signup': () => { closeAllSheets(); S.authTab = 'register'; showAuth(); },
    'guest-guide': () => openGuestGuide(),
    'guest-bar-close': () => { S.guestBarClosed = true; renderGuestBar(); },
    'guest-back': () => {
      $('#view-auth').classList.add('hidden');
      if (St.guest && P()) renderApp();
      else enterGuest(false);
    },

    'onb-set': d => { readOnb(); S.onb[d.k] = isNaN(Number(d.v)) ? d.v : Number(d.v); renderOnboard(); },
    'pick-birth': () => pickNumber('出生年份', 1940, 2016, 1, S.onb.birthYear, 0, v => { S.onb.birthYear = v; renderOnboard(); }),
    'pick-height': () => pickNumber('身高（cm）', 120, 220, 1, S.onb.height, 0, v => { S.onb.height = v; renderOnboard(); }),
    'pick-weight': () => pickNumber('当前体重（斤）', 60, 400, 0.5, toJ(S.onb.weightKg), 1, v => { S.onb.weightKg = toKg(v); renderOnboard(); }),
    'pick-target': () => pickNumber('预期体重（斤）', 60, 400, 0.5, toJ(S.onb.targetKg), 1, v => { S.onb.targetKg = toKg(v); renderOnboard(); }),
    'pick-date': () => pickDate('预期达成日期', S.onb.targetDate, v => { S.onb.targetDate = v; renderOnboard(); }),
    'onb-multi': d => {
      readOnb();
      const arr = S.onb[d.k];
      const i = arr.indexOf(d.v);
      if (i >= 0) arr.splice(i, 1); else arr.push(d.v);
      renderOnboard();
    },
    'onb-next': () => onbNext(),
    'onb-back': () => { readOnb(); S.onbStep--; renderOnboard(); },
    'onb-finish': () => onbFinish(),

    'open-checkin': () => openCheckin(),
    'ci-pick-weight': () => pickNumber('体重（斤）', 40, 700, 0.5, S.ciWeight, 1, v => { S.ciWeight = v; renderCheckin(); }),
    'ci-pick-date': () => pickDate('记录日期', S.ciDate, v => { S.ciDate = v; renderCheckin(); }, { from: new Date().getFullYear() - 3, to: new Date().getFullYear() }),
    'save-checkin': () => saveCheckin(),
    'sheet-mask': (d, el, e) => { if (e.target === el) closeSheet(); },
    'close-sheet': () => closeSheet(),

    'range': d => { S.range = Number(d.v); renderTrend(); },
    'open-food': d => openFoodPicker(d.slot, 'log'),
    'meal-eat': d => recordMealPreset(d.slot, Number(d.f)),
    'reset-meal': async d => {
      const list = todayMeals().filter(m => m.slot === d.slot);
      for (const m of list) await St.deleteMeal(m.id);
      renderApp();
    },
    'open-meal-preset': () => openMealPresetSheet(),
    'edit-preset-meal': d => { closeSheet(); openFoodPicker(d.slot, 'preset'); },
    'edit-day': d => openDayEdit(d.dow),
    'day-sub-toggle': () => {
      S.dayEdit.subOpen = !S.dayEdit.subOpen;
      layoutSubChips();
    },
    'day-cat': d => {
      S.dayEdit.cat = d.v;
      S.dayEdit.sub = 'all';
      document.querySelectorAll('.side-cat').forEach(b => b.classList.toggle('on', b.dataset.v === d.v));
      const chips = document.getElementById('ex-subs');
      if (chips) chips.innerHTML = exSubsHtml();
      const g = document.getElementById('ex-grid');
      if (g) { g.innerHTML = exGridHtml(); g.scrollTop = 0; }
      layoutSubChips();
    },
    'day-sub': d => {
      S.dayEdit.sub = d.v;
      const chips = document.getElementById('ex-subs');
      if (chips) chips.innerHTML = exSubsHtml();
      const g = document.getElementById('ex-grid');
      if (g) { g.innerHTML = exGridHtml(); g.scrollTop = 0; }
    },
    'day-toggle': d => {
      const st = S.dayEdit;
      const i = st.items.findIndex(x => x.n === d.name);
      if (i >= 0) st.items.splice(i, 1);
      else {
        const ex = window.EXERCISES.find(e => e.name === d.name);
        st.items.push(ex && ex.unit === 'min' ? { n: d.name, min: 20 } : { n: d.name, sets: 3, reps: '12' });
      }
      const cell = document.querySelector('.food-cell[data-name="' + d.name + '"]');
      if (cell) {
        const on = cell.classList.toggle('on');
        const b = cell.querySelector('.food-add');
        if (b) b.textContent = on ? '✓' : '+';
      }
      const cnt = document.getElementById('ex-count');
      if (cnt) cnt.textContent = '已选 ' + st.items.length + ' 个';
      const done = document.querySelector('[data-act="day-done"]');
      if (done) done.textContent = '完成（已选 ' + st.items.length + ' 个）';
    },
    'day-done': () => { S.dayEdit.picking = false; renderDayEdit(); },
    'day-pick': () => { S.dayEdit.picking = true; S.exQ = ''; renderDayEdit(); },
    'ex-showall': () => { S.exShowAll = !S.exShowAll; renderDayEdit(); },
    'day-del': d => {
      S.dayEdit.items.splice(Number(d.i), 1);
      const list = document.getElementById('day-list');
      if (list) list.innerHTML = dayListHtml();
    },
    'day-save': async () => {
      const plan = { ...weekPlan() };
      plan[S.dayEdit.dow] = S.dayEdit.items;
      const r = await setWeekPlan(plan);
      if (r.error) return toast(r.error);
      guestNote(); closeSheet(); toast('已保存'); renderApp();
    },
    'regen-plan': async () => {
      if (!confirm('按「' + currentTemplate().name + '」重新铺一周？手动改过的安排会被覆盖。')) return;
      const r = await applyPlanFreq();
      if (r.error) return toast(r.error);
      toast('已按模板重排');
      renderApp();
    },
    'food-cat': d => setFoodCat(d.v),
    'food-scene': d => setFoodScene(d.v),
    'food-toggle': d => {
      const i = S.mealSel.findIndex(x => String(x) === String(d.id));
      if (i >= 0) S.mealSel.splice(i, 1); else S.mealSel.push(d.id);
      const cell = document.querySelector('.food-cell[data-id="' + d.id + '"]');
      if (cell) {
        const on = cell.classList.toggle('on');
        const b = cell.querySelector('.food-add');
        if (b) b.textContent = on ? '✓' : '+';
      }
      updateFoodCalc();
    },
    'save-meal': () => saveMeal(),
    'clear-meal': async d => {
      const list = todayMeals().filter(m => m.slot === d.slot);
      if (!confirm('清空今天' + SLOT_NAME[d.slot] + '的 ' + list.length + ' 条记录？')) return;
      for (const m of list) await St.deleteMeal(m.id);
      toast('已清空'); renderApp();
    },

    'log-ex': async d => {
      const r = await St.addWorkout(today(), d.name, Number(d.min), Number(d.kcal));
      if (r.error) return toast(r.error);
      toast('完成 +' + d.kcal + ' kcal'); renderApp();
    },
    'swap-ex': d => openSwap(d.name, d.muscle),
    'pick-swap': async d => {
      const cp = calcProfile();
      const kcal = E.kcalOf(Number(d.met), cp.weight, 15);
      const r = await St.addWorkout(today(), d.name, 15, kcal);
      if (r.error) return toast(r.error);
      closeSheet(); toast('已换成 ' + d.name); renderApp();
    },
    'block-ex': async d => {
      if (!confirm('以后不再推荐「' + d.name + '」？可在「我的」里恢复。')) return;
      const r = await St.block('blocked_ex', d.name);
      if (r.error) return toast(r.error);
      toast('已屏蔽'); renderApp();
    },
    'quick-add-ex': async d => {
      const cp = calcProfile();
      const ex = window.EXERCISES.find(e => e.name === d.name);
      const kcal = E.kcalOf(ex ? ex.met : 4, cp.weight, 20);
      const r = await St.addWorkout(today(), d.name, 20, kcal);
      if (r.error) return toast(r.error);
      toast('已加入今日训练');
    },
    'custom-ex': () => openCustomEx(),
    'cx-level': (d, el) => {
      S.cxLevel = Number(d.v);
      el.parentElement.querySelectorAll('.seg-item').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
    },
    'save-custom-ex': () => saveCustomEx(),

    'custom-food': () => openCustomFood(),
    'cf-cat': (d, el) => {
      S.cfCat = d.v;
      el.parentElement.querySelectorAll('.chip').forEach(b => b.classList.remove('on'));
      el.classList.add('on');
    },
    'save-custom-food': () => saveCustomFood(),
    'del-custom': async d => {
      if (!confirm('删除这条自定义内容？')) return;
      const r = await St.deleteCustom(d.id);
      if (r.error) return toast(r.error);
      toast('已删除'); renderApp();
    },
    'unblock': async d => {
      const r = await St.unblock(d.id);
      if (r.error) return toast(r.error);
      toast('已恢复推荐'); renderApp();
    },

    'choose-plan': () => openChoosePlan(),
    'ex-detail': (d, el) => {
      // 点在 + 按钮上时交给 day-toggle 处理
      if (el.tagName === 'BUTTON') return;
      openExDetail(d.name);
    },
    'goto-lib': () => {
      S.view = 'exlib';
      renderApp();
      window.scrollTo({ top: 0 });
    },
    'lib-ex': d => openExDetail(d.name, { lib: true }),
    'lib-cat-toggle': () => {
      const st = libState();
      st.open = !st.open;
      const cats = document.getElementById('lib-cats');
      const btn = document.querySelector('.lib-cat-toggle');
      if (cats) cats.classList.toggle('open', st.open);
      if (btn) btn.classList.toggle('open', st.open);
      layoutLibCats();
    },
    'lib-mine': () => {
      const st = libState();
      st.mine = !st.mine;
      renderLib();
    },
    'lib-equip': d => {
      const st = libState();
      const i = st.equips.indexOf(d.v);
      if (i >= 0) st.equips.splice(i, 1);
      else st.equips.push(d.v);
      renderLib();
    },
    'lib-cat': d => {
      const st = libState();
      st.cat = d.v;
      st.show = LIB_PAGE;
      const row = document.getElementById('lib-cats-row');
      if (row) row.innerHTML = libCatsHtml();
      const g = document.getElementById('lib-grid');
      if (g) g.innerHTML = libGridHtml();
      const list = libPool();
      const c = document.getElementById('lib-count');
      if (c) c.textContent = '共 ' + list.length + ' 个 · 点卡片看示范';
      const t = document.querySelector('.lib-list-card .card-title');
      if (t) t.textContent = st.cat === 'all' ? '全部动作' : (LIB_CAT_NAME[st.cat] || '') + '部动作';
      bindLibThumbs();
      layoutLibCats();
      const bar = document.querySelector('.lib-cats-row');
      if (bar) window.scrollTo({ top: Math.max(0, bar.offsetTop - 64) });
    },
    'lib-more': () => {
      const st = libState();
      st.show += LIB_PAGE;
      const g = document.getElementById('lib-grid');
      if (g) g.innerHTML = libGridHtml();
      bindLibThumbs();
    },
    'lib-add-today': async d => {
      const cp = calcProfile();
      const ex = window.EXERCISES.find(e => e.name === d.name);
      const kcal = E.kcalOf(ex ? ex.met : 4, cp.weight, 20);
      const r = await St.addWorkout(today(), d.name, 20, kcal);
      if (r.error) return toast(r.error);
      closeSheet();
      toast('已加入今日训练 · ' + d.name);
      if (S.view === 'today') renderApp();
    },
    'pick-plan': async d => {
      const cpx = calcProfile();
      const mode = cpx.freqMode || 'weekly';
      const tpl = window.PLAN_TEMPLATES.find(t => t.id === d.v);
      const r = await St.saveProfile({ planId: d.v, freqCount: tplDefaultFreq(tpl, mode) });
      if (r.error) return toast(r.error);
      const r2 = await applyPlanFreq(tpl);
      if (r2.error) return toast(r2.error);
      closeSheet();
      toast('已切换，每周计划按新模板重排好了');
      renderApp();
    },
    'freq-mode': async d => {
      if ((P().freqMode || 'weekly') === d.v) return;
      const r = await St.saveProfile({ freqMode: d.v, freqCount: tplDefaultFreq(currentTemplate(), d.v) });
      if (r.error) return toast(r.error);
      const r2 = await applyPlanFreq();
      if (r2.error) return toast(r2.error);
      toast(d.v === 'monthly' ? '已改为按月安排，计划已重排' : '已改为按周安排，计划已重排');
      renderApp();
    },
    'freq-edit': () => {
      const cp = calcProfile();
      const monthly = cp.freqMode === 'monthly';
      const opts = monthly ? [4, 6, 8, 10, 12, 16, 20, 24, 28] : [1, 2, 3, 4, 5, 6, 7];
      const tpl = currentTemplate();
      const size = (n, isMonthly) => {
        if (!isMonthly) return n + ' 天';
        return n + ' 次<em style="font-style:normal;opacity:.5;font-size:10px"> ≈ ' + perWeekLabel(n) + '</em>';
      };
      openSheet(monthly ? '每月练几次' : '每周练几天', `
        <div class="chips">${opts.map(n => `<button class="chip ${cp.freqCount === n ? 'on' : ''}" data-act="pick-freq" data-v="${n}">${size(n, monthly)}</button>`).join('')}</div>
        <div class="hint mt12">「${esc(tpl.name)}」默认 ${monthly ? tpl.daysPerMonth + ' 次/月' : tpl.daysPerWeek + ' 天/周'}。改完立刻按新次数重排这一周，手动改过的日子会跟着重排。</div>`);
    },
    'pick-freq': async d => {
      const r = await St.saveProfile({ freqCount: Number(d.v) });
      if (r.error) return toast(r.error);
      const r2 = await applyPlanFreq();
      if (r2.error) return toast(r2.error);
      closeSheet();
      toast('计划已按新次数重排');
      renderApp();
    },

    'edit-goal': () => openGoalEdit(),
    'g-pick-cur': () => pickNumber('起始体重（斤）', 40, 700, 0.5, S.gCur, 1, v => { S.gCur = v; renderGoalSheet(); }),
    'g-pick-target': () => pickNumber('预期体重（斤）', 40, 700, 0.5, S.gTarget, 1, v => { S.gTarget = v; renderGoalSheet(); }),
    'g-pick-date': () => pickDate('预期达成日期', S.gDate, v => { S.gDate = v; renderGoalSheet(); }),
    'save-goal': () => saveGoal(),
    'dismiss-warn': d => {
      try { localStorage.setItem('bm_warn_dismissed', d.fp); } catch (err) {}
      const n = document.querySelector('.warn-dismiss');
      if (n) n.remove();
      toast('已关闭，修改目标后会重新提醒');
    },
    'edit-equip': () => openEquipEdit(),
    'open-profile': () => openProfileCenter(),
    'eq-toggle': (d, el) => {
      if (S.eqSel.has(d.v)) S.eqSel.delete(d.v); else S.eqSel.add(d.v);
      el.classList.toggle('on');
    },
    'lim-toggle': (d, el) => {
      if (S.limSel.has(d.v)) S.limSel.delete(d.v); else S.limSel.add(d.v);
      el.classList.toggle('on');
    },
    'save-equip': async () => {
      const eq = [...S.eqSel];
      const r = await St.saveProfile({ equipment: eq.length ? eq : ['none'], limitations: [...S.limSel] });
      if (r.error) return toast(r.error);
      // 器械条件变了：按新条件重新匹配模板，并把周计划版本回退一位，下次加载自动重铺
      const p = P() || {};
      const tpl = pickTemplate({ ...p, equipment: eq.length ? eq : ['none'] });
      _wp = null;
      await St.saveProfile({ planId: tpl.id, extra: { ...(p.extra || {}), weekPlanVer: WP_VER - 1 } });
      guestNote(); closeSheet(); toast('已更新，训练计划按新器械重排'); renderApp();
    },
    'edit-diet': () => openDietEdit(),
    'diet-set': (d, el) => {
      S.dietSel = d.v;
      el.parentElement.querySelectorAll('.chip').forEach(b => b.classList.remove('on'));
      el.classList.add('on');
    },
    'avoid-toggle': (d, el) => {
      if (S.disSel.has(d.v)) S.disSel.delete(d.v); else S.disSel.add(d.v);
      el.classList.toggle('on');
    },
    'save-diet': async () => {
      const r = await St.saveProfile({ dietStyle: S.dietSel, dislikes: [...S.disSel] });
      if (r.error) return toast(r.error);
      guestNote(); closeSheet(); toast('已更新'); renderApp();
    },

    'signout': async () => {
      if (!confirm('退出登录？数据保存在云端，下次登录还在。')) return;
      await St.signOut();
      S.pending = null;
      closeAllSheets();
      toast('已退出，现在是游客体验');
      enterGuest(false);
    },
    'export': () => openShareCard(),
    'share-send': () => sendSharePng(),
    'share-save': () => saveSharePng(),
    'pf-gender': () => openSheet('选择性别', `
      <button class="btn btn-block mb8" data-act="pf-gender-set" data-v="male">男 · 按男性代谢计算</button>
      <button class="btn btn-block" data-act="pf-gender-set" data-v="female">女 · 按女性代谢计算</button>
      <div class="hint mt8" style="text-align:center">性别影响基础代谢与摄入下限，改完立即生效</div>`, ''),
    'pf-gender-set': async d => {
      const r = await St.saveProfile({ gender: d.v });
      if (r && r.error) return toast(r.error);
      guestNote(); toast('已更新'); pfRelayout();
    },
    'pf-birth': () => {
      const cp = calcProfile();
      pickNumber('出生年份', 1940, new Date().getFullYear() - 8, 1, cp.birthYear || 1995, 0, async v => {
        const r = await St.saveProfile({ birthYear: v });
        if (r && r.error) return toast(r.error);
        guestNote(); toast('已更新'); pfRelayout();
      });
    },
    'pf-height': () => {
      const cp = calcProfile();
      pickNumber('身高（cm）', 120, 220, 1, cp.height || 170, 0, async v => {
        const r = await St.saveProfile({ height: v });
        if (r && r.error) return toast(r.error);
        guestNote(); toast('已更新'); pfRelayout();
      });
    },
    'pf-goal': () => { openGoalEdit(); }
  };

  /* 游客的任何一次修改都只落在内存里：第一次提示一句，之后让顶部提示条闪一下 */
  function guestNote() {
    if (!St.guest) return;
    const gb = $('#guestbar');
    if (gb && !S.guestBarClosed) {
      gb.classList.remove('flash');
      void gb.offsetWidth;
      gb.classList.add('flash');
    }
    if (!S.guestWarned) {
      S.guestWarned = true;
      toast('游客模式：改动只在本页，登录后才会保存');
    }
  }

  ['logWeight', 'deleteWeight', 'addWorkout', 'deleteWorkout',
    'addMeal', 'addMeals', 'deleteMeal', 'saveCustom', 'deleteCustom'].forEach(k => {
      const raw = St[k].bind(St);
      St[k] = async function (...args) {
        const r = await raw(...args);
        if (St.guest) guestNote();
        return r;
      };
    });

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = handlers[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'food-search') {
      S.foodQ = e.target.value;
      const g = document.getElementById('food-grid');
      if (g) g.innerHTML = foodGridHtml();
    }
    if (e.target.id === 'ex-search') {
      S.exQ = e.target.value;
      const g = document.getElementById('ex-grid');
      if (g) g.innerHTML = exGridHtml();
    }
    if (e.target.id === 'lib-search') {
      const st = libState();
      st.q = e.target.value;
      st.show = LIB_PAGE;
      const row = document.getElementById('lib-cats-row');
      if (row) row.innerHTML = libCatsHtml();
      const g = document.getElementById('lib-grid');
      if (g) g.innerHTML = libGridHtml();
      const c = document.getElementById('lib-count');
      if (c) c.textContent = '共 ' + libPool().length + ' 个 · 点卡片看示范';
      bindLibThumbs();
      layoutLibCats();
    }
  });

  document.addEventListener('change', e => {
    if (e.target.id === 'onb-activity') { readOnb(); updatePreview(); }
    if (e.target.id === 'g-activity') previewGoal();
  });

  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => { S.view = b.dataset.view; renderApp(); window.scrollTo({ top: 0 }); });
  });

  boot();
})();
