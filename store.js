/* 云端数据层：认证 + 数据读写，全部走 WorkBuddy Cloud Service */
(function () {
  const cfg = window.APP_CONFIG;
  let cloud = null;
  let db = null;

  /* SDK 的错误对象结构不统一（string / {message} / {kind,message}），统一取可读文案 */
  function errText(e, dft) {
    if (!e) return dft;
    if (typeof e === 'string') return e;
    return e.message || e.msg || e.error_description || dft;
  }

  /* ============ 游客体验数据 ============
     全部在内存里，绝不写数据库：刷新页面就回到这份初始样例。 */
  let _gseq = 0;
  const gid = pre => 'g' + pre + (++_gseq);

  /* 固定种子的伪随机，保证每次打开看到的样例一致 */
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function buildGuestState() {
    const E = window.Engine;
    const d0 = E.today();
    const startDate = E.addDays(d0, -46);

    const profile = {
      gender: 'female', birthYear: 1993, height: 163, activity: 'light',
      goalType: 'cut',
      startWeight: 63.5, targetWeight: 56.5,
      startDate, targetDate: E.addDays(d0, 74),
      planId: 'tpl-home-5', freqMode: 'weekly', freqCount: 4,
      equipment: ['none', 'dumbbell'], limitations: [],
      dietStyle: 'normal', dislikes: ['香菜'],
      extra: {}
    };

    /* 体重：47 天里记了 40 次，中间有断档和一段平台期 */
    const rnd = seeded(20261110);
    const weights = [];
    for (let i = 46; i >= 0; i--) {
      if (i % 7 === 3) continue;
      const k = 46 - i;
      const trend = 63.5 - k * 0.055;
      const plateau = (k >= 18 && k < 27) ? 0.45 : 0;
      const w = Math.round((trend + plateau + (rnd() - 0.5) * 0.5) * 10) / 10;
      weights.push({
        id: gid('w'), date: E.addDays(d0, -i), weight: w,
        waist: k % 12 === 0 ? Math.round((80 - k * 0.05) * 10) / 10 : null,
        note: k === 0 ? '开始记录' : (k === 18 ? '这周聚餐多，先稳住' : '')
      });
    }

    /* 训练：按方案铺在过去三周，故意漏练一天 */
    const tpl = (window.PLAN_TEMPLATES || []).find(t => t.id === profile.planId);
    const wp = tpl ? E.buildWeekPlan(tpl, 'weekly', profile.freqCount) : {};
    const workouts = [];
    for (let i = 21; i >= 1; i--) {
      if (i === 12) continue;
      const d = E.addDays(d0, -i);
      const dow = new Date(d + 'T00:00:00').getDay() || 7;
      const items = (wp[dow] || []).slice(0, 3);
      items.forEach(it => {
        const min = E.estimateMinutes(it);
        workouts.push({
          id: gid('k'), date: d, name: it.n, minutes: min,
          kcal: E.kcalOf(4.6, 62, min), done: true
        });
      });
    }

    /* 三餐：近两周按目标热量配好，今天只吃了早饭 */
    const pl = E.plan({ ...profile, weight: 62 });
    const foods = window.FOODS || [];
    const share = { b: 0.3, l: 0.4, d: 0.3 };
    const meals = [];
    for (let back = 13; back >= 0; back--) {
      if (back === 8) continue;
      const date = E.addDays(d0, -back);
      const slots = back === 0 ? ['b'] : ['b', 'l', 'd'];
      slots.forEach(slot => {
        const pool = foods.filter(f => (f.slots || []).includes(slot));
        if (!pool.length) return;
        const off = (back * 5) % pool.length;
        const pick = pool.slice(off).concat(pool.slice(0, off)).slice(0, 4);
        const part = E.portion(pick, Math.round(pl.targetIntake * share[slot]), slot);
        part.items.forEach(it => meals.push({
          id: gid('m'), date, slot, name: it.name,
          grams: it.grams, kcal: it.kcal,
          protein: it.protein || 0, fat: it.fat || 0, carb: it.carb || 0
        }));
      });
    }

    const customs = [
      { id: gid('c'), kind: 'custom_food', name: '无糖拿铁', payload: { cat: 'protein', kcal: 90, p: 6, f: 5, c: 6, unit: '杯', g: 350 } },
      { id: gid('c'), kind: 'custom_ex', name: '弹力带划船', payload: { muscle: 'back', level: 1, met: 4.5 } }
    ];

    return { profile, weights, workouts, meals, customs };
  }

  const Store = {
    cloud: null,
    session: null,
    state: { profile: null, weights: [], workouts: [], meals: [], customs: [] },
    online: false,
    guest: false,
    lastError: '',
    _reset: null,

    init() {
      if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
        this.lastError = '云端 SDK 未加载，请检查网络后刷新页面。';
        return false;
      }
      try {
        cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
          endpoint: cfg.endpoint,
          oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
          publishableKey: cfg.publishableKey
        });
        db = cloud.database;
        this.cloud = cloud;
        this.online = true;
        return true;
      } catch (e) {
        this.lastError = '云端初始化失败：' + (e && e.message ? e.message : e);
        return false;
      }
    },

    /* ---------------- 游客模式（纯内存，不写库） ---------------- */
    enterGuest() {
      this.guest = true;
      this.session = null;
      this.lastError = '';
      this.state = buildGuestState();
      return this.state;
    },

    leaveGuest() {
      this.guest = false;
    },

    /* ---------------- 认证 ---------------- */
    async restore() {
      if (!cloud) return null;
      try {
        const { data, error } = await cloud.auth.getSession();
        if (error) { this.lastError = error.message || '会话恢复失败'; return null; }
        this.session = data || null;
        return this.session;
      } catch (e) {
        this.lastError = e.message || '会话恢复失败';
        return null;
      }
    },

    async sendCode(account, type) {
      if (!cloud) return { error: '云端未连接' };
      const payload = type === 'phone' ? { phone: account } : { email: account };
      try {
        const { data, error } = await cloud.auth.sendOtp(payload);
        if (error) return { error: error.message || '验证码发送失败' };
        return { data };
      } catch (e) {
        return { error: e.message || '验证码发送失败' };
      }
    },

    async register({ account, type, code, password, verificationId, isExistingUser }) {
      if (!cloud) return { error: '云端未连接' };
      const payload = {
        verificationId,
        isExistingUser: !!isExistingUser,
        token: code,
        password
      };
      if (type === 'phone') payload.phone = account; else payload.email = account;
      try {
        const { data, error } = await cloud.auth.verifyOtp(payload);
        if (error) return { error: error.message || '注册失败' };
        this.session = data && data.session ? data.session : null;
        this.guest = false;
        return { data };
      } catch (e) {
        return { error: e.message || '注册失败' };
      }
    },

    async signIn({ account, type, password }) {
      if (!cloud) return { error: '云端未连接' };
      const credentials = type === 'phone' ? { phone: account, password } : { email: account, password };
      try {
        const { data, error } = await cloud.auth.signInWithPassword(credentials);
        if (error) return { error: '账号或密码不正确' };
        this.session = data && data.session ? data.session : data;
        this.guest = false;
        return { data };
      } catch (e) {
        return { error: e.message || '登录失败' };
      }
    },

    /* 邮箱找回密码：第 1 步发验证码，第 2 步用验证码 + 新密码重置并自动登录。
       SDK 的 resetPasswordForEmail 返回的是一个带 updateUser({nonce,password}) 的句柄，
       必须留到第 2 步用，所以存在实例上。 */
    async sendResetCode(email) {
      if (!cloud) return { error: '云端未连接' };
      try {
        const { data, error } = await cloud.auth.resetPasswordForEmail(email);
        if (error) return { error: errText(error, '验证码发送失败') };
        if (!data || typeof data.updateUser !== 'function') return { error: '服务端暂不支持邮箱重置密码' };
        this._reset = data;
        return { data: { ok: true } };
      } catch (e) { return { error: errText(e, '验证码发送失败') }; }
    },

    async confirmReset(email, nonce, password) {
      if (!cloud) return { error: '云端未连接' };
      if (!this._reset) return { error: '请先获取验证码' };
      try {
        const { data, error } = await this._reset.updateUser({ nonce, password });
        if (error) return { error: errText(error, '重置失败，请检查验证码是否正确') };
        this.session = data && data.session ? data.session : data;
        this.guest = false;
        this._reset = null;
        return { data };
      } catch (e) { return { error: errText(e, '重置失败，请检查验证码是否正确') }; }
    },

    /* 手机号没有"重置密码"接口，用验证码直接登录（isExistingUser=true 时 verifyOtp 走登录） */
    async loginWithCode({ account, type, verificationId, token }) {
      if (!cloud) return { error: '云端未连接' };
      const payload = { verificationId, token, isExistingUser: true };
      if (type === 'phone') payload.phone = account; else payload.email = account;
      try {
        const { data, error } = await cloud.auth.verifyOtp(payload);
        if (error) return { error: errText(error, '验证码不正确') };
        this.session = data && data.session ? data.session : data;
        this.guest = false;
        return { data };
      } catch (e) { return { error: errText(e, '验证码不正确') }; }
    },

    /* 已登录时改密码：先 sudo 校验旧密码，再 PATCH 新密码 */
    async changePassword(oldPassword, newPassword) {
      if (!cloud) return { error: '云端未连接' };
      try {
        const { data, error } = await cloud.auth.resetPasswordForOld({ oldPassword, newPassword });
        if (error) return { error: errText(error, '修改失败，请检查原密码') };
        if (data) this.session = data && data.session ? data.session : data;
        return { data };
      } catch (e) { return { error: errText(e, '修改失败，请检查原密码') }; }
    },

    async signOut() {
      if (!cloud) return;
      try { await cloud.auth.signOut(); } catch (e) { /* 忽略 */ }
      this.session = null;
      this.guest = false;
      this.state = { profile: null, weights: [], workouts: [], meals: [], customs: [] };
    },

    userLabel() {
      const u = this.session && this.session.user;
      if (!u) return '';
      if (u.name) return u.name;
      const id = u.email || u.phone || '';
      if (!id) return '用户';
      if (id.includes('@')) {
        const [a, b] = id.split('@');
        return a.slice(0, 2) + '***@' + b;
      }
      return id.slice(0, 3) + '****' + id.slice(-2);
    },

    /* ---------------- 数据加载 ---------------- */
    async loadAll() {
      if (this.guest) return { data: true };
      if (!cloud) return { error: '云端未连接' };
      const since = Engine.addDays(Engine.today(), -180);
      try {
        const [pf, wt, wk, ml, cs] = await Promise.all([
          db.from('bm_profiles').select('*').limit(1),
          db.from('bm_weight_logs').select('*').gte('log_date', since).order('log_date', { ascending: true }),
          db.from('bm_workout_logs').select('*').gte('log_date', since).order('log_date', { ascending: true }),
          db.from('bm_meal_logs').select('*').gte('log_date', since).order('log_date', { ascending: true }),
          db.from('bm_custom_items').select('*').order('created_at', { ascending: true })
        ]);
        const first = [pf, wt, wk, ml, cs].find(r => r.error);
        if (first) return { error: first.error.message || '数据加载失败' };

        this.state.profile = (pf.data && pf.data[0]) || null;
        this.state.weights = (wt.data || []).map(r => ({
          id: r.id, date: r.log_date, weight: Number(r.weight_kg),
          waist: r.waist_cm == null ? null : Number(r.waist_cm), note: r.note || ''
        }));
        this.state.workouts = (wk.data || []).map(r => ({
          id: r.id, date: r.log_date, name: r.exercise_name,
          minutes: r.duration_min || 0, kcal: r.kcal || 0, done: r.done !== false
        }));
        this.state.meals = (ml.data || []).map(r => ({
          id: r.id, date: r.log_date, slot: r.meal_slot, name: r.food_name,
          grams: Number(r.grams) || 0, kcal: Number(r.kcal) || 0,
          protein: Number(r.protein) || 0, fat: Number(r.fat) || 0, carb: Number(r.carb) || 0
        }));
        this.state.customs = (cs.data || []).map(r => ({
          id: r.id, kind: r.kind, name: r.name, payload: r.payload || {}
        }));
        return { data: true };
      } catch (e) {
        return { error: e.message || '数据加载失败' };
      }
    },

    /* ---------------- 档案 ---------------- */
    async saveProfile(patch) {
      const cur = this.state.profile || {};
      const merged = { ...cur, ...patch };
      if (this.guest) {
        this.state.profile = merged;
        return { data: this.state.profile, guest: true };
      }
      const row = {
        owner_name: this.session && this.session.user && this.session.user.name || null,
        gender: merged.gender || 'male',
        birth_year: merged.birthYear ? Number(merged.birthYear) : null,
        height_cm: merged.height ? Number(merged.height) : null,
        activity_level: merged.activity || 'light',
        goal_type: merged.goalType || 'cut',
        start_weight: merged.startWeight ? Number(merged.startWeight) : null,
        target_weight: merged.targetWeight ? Number(merged.targetWeight) : null,
        start_date: merged.startDate || null,
        target_date: merged.targetDate || null,
        plan_id: merged.planId || null,
        freq_mode: merged.freqMode || 'weekly',
        freq_count: merged.freqCount ? Number(merged.freqCount) : 3,
        equipment: merged.equipment || ['none'],
        limitations: merged.limitations || [],
        diet_style: merged.dietStyle || 'normal',
        dislikes: merged.dislikes || [],
        extra: merged.extra || {},
        updated_at: new Date().toISOString()
      };
      try {
        let out;
        if (cur.id) {
          out = await db.from('bm_profiles').update(row).eq('id', cur.id).select();
        } else {
          out = await db.from('bm_profiles').insert(row).select();
        }
        if (out.error) return { error: out.error.message };
        const saved = (out.data || [])[0];
        if (!saved) return { error: '保存失败：没有写入权限或记录不存在' };
        this.state.profile = this.mapProfile(saved);
        return { data: this.state.profile };
      } catch (e) {
        return { error: e.message || '保存失败' };
      }
    },

    mapProfile(r) {
      return {
        id: r.id,
        gender: r.gender, birthYear: r.birth_year, height: r.height_cm && Number(r.height_cm),
        activity: r.activity_level, goalType: r.goal_type,
        startWeight: r.start_weight && Number(r.start_weight),
        targetWeight: r.target_weight && Number(r.target_weight),
        startDate: r.start_date, targetDate: r.target_date,
        planId: r.plan_id, freqMode: r.freq_mode, freqCount: r.freq_count,
        equipment: r.equipment || ['none'], limitations: r.limitations || [],
        dietStyle: r.diet_style, dislikes: r.dislikes || [],
        extra: r.extra || {}
      };
    },

    /* ---------------- 体重 ---------------- */
    async logWeight(date, weight, waist, note) {
      if (this.guest) {
        const row = {
          id: 'gw-' + date, date,
          weight: Number(weight), waist: waist ? Number(waist) : null, note: note || ''
        };
        const list = this.state.weights;
        const i = list.findIndex(w => w.date === date);
        if (i >= 0) list[i] = { ...list[i], ...row, id: list[i].id };
        else { list.push(row); list.sort((a, b) => a.date < b.date ? -1 : 1); }
        return { data: row, guest: true };
      }
      try {
        const exist = await db.from('bm_weight_logs').select('id').eq('log_date', date).maybeSingle();
        if (exist.error && exist.error.code !== 'PGRST116') return { error: exist.error.message };
        const row = { weight_kg: Number(weight), waist_cm: waist ? Number(waist) : null, note: note || null };
        let out;
        if (exist.data && exist.data.id) {
          out = await db.from('bm_weight_logs').update(row).eq('id', exist.data.id).select();
        } else {
          out = await db.from('bm_weight_logs').insert({
            ...row, log_date: date,
            owner_name: this.session && this.session.user && this.session.user.name || null
          }).select();
        }
        if (out.error) return { error: out.error.message };
        const saved = (out.data || [])[0];
        if (!saved) return { error: '写入失败，请确认已登录' };
        await this.reloadWeights();
        return { data: saved };
      } catch (e) { return { error: e.message || '打卡失败' }; }
    },

    async reloadWeights() {
      const since = Engine.addDays(Engine.today(), -365);
      const r = await db.from('bm_weight_logs').select('*').gte('log_date', since).order('log_date', { ascending: true });
      if (r.error) return { error: r.error.message };
      this.state.weights = (r.data || []).map(x => ({
        id: x.id, date: x.log_date, weight: Number(x.weight_kg),
        waist: x.waist_cm == null ? null : Number(x.waist_cm), note: x.note || ''
      }));
      return { data: true };
    },

    async deleteWeight(id) {
      if (this.guest) {
        this.state.weights = this.state.weights.filter(w => String(w.id) !== String(id));
        return { data: true, guest: true };
      }
      const r = await db.from('bm_weight_logs').delete().eq('id', id).select();
      if (r.error) return { error: r.error.message };
      if (!(r.data || []).length) return { error: '记录不存在或无权删除' };
      await this.reloadWeights();
      return { data: true };
    },

    /* ---------------- 训练记录 ---------------- */
    async addWorkout(date, name, minutes, kcal) {
      if (this.guest) {
        const row = {
          id: gid('k'), date, name,
          minutes: Math.round(minutes), kcal: Math.round(kcal), done: true
        };
        this.state.workouts.push(row);
        return { data: row, guest: true };
      }
      const r = await db.from('bm_workout_logs').insert({
        log_date: date, exercise_name: name, duration_min: Math.round(minutes), kcal: Math.round(kcal),
        owner_name: this.session && this.session.user && this.session.user.name || null
      }).select();
      if (r.error) return { error: r.error.message };
      await this.reloadWorkouts();
      return { data: (r.data || [])[0] };
    },

    async reloadWorkouts() {
      const since = Engine.addDays(Engine.today(), -365);
      const r = await db.from('bm_workout_logs').select('*').gte('log_date', since).order('log_date', { ascending: true });
      if (r.error) return { error: r.error.message };
      this.state.workouts = (r.data || []).map(x => ({
        id: x.id, date: x.log_date, name: x.exercise_name,
        minutes: x.duration_min || 0, kcal: x.kcal || 0, done: x.done !== false
      }));
      return { data: true };
    },

    async deleteWorkout(id) {
      if (this.guest) {
        this.state.workouts = this.state.workouts.filter(w => String(w.id) !== String(id));
        return { data: true, guest: true };
      }
      const r = await db.from('bm_workout_logs').delete().eq('id', id).select();
      if (r.error) return { error: r.error.message };
      await this.reloadWorkouts();
      return { data: true };
    },

    /* ---------------- 饮食记录 ---------------- */
    async addMeal(date, slot, item) {
      if (this.guest) {
        const row = {
          id: gid('m'), date, slot, name: item.name,
          grams: Number(item.grams) || 0, kcal: Number(item.kcal) || 0,
          protein: item.protein || 0, fat: item.fat || 0, carb: item.carb || 0
        };
        this.state.meals.push(row);
        return { data: row, guest: true };
      }
      const r = await db.from('bm_meal_logs').insert({
        log_date: date, meal_slot: slot, food_name: item.name,
        grams: item.grams, kcal: item.kcal,
        protein: item.protein || 0, fat: item.fat || 0, carb: item.carb || 0,
        owner_name: this.session && this.session.user && this.session.user.name || null
      }).select();
      if (r.error) return { error: r.error.message };
      await this.reloadMeals();
      return { data: (r.data || [])[0] };
    },

    async addMeals(date, slot, items) {
      if (!items || !items.length) return { data: true };
      if (this.guest) {
        const rows = items.map(it => ({
          id: gid('m'), date, slot, name: it.name,
          grams: Number(it.grams) || 0, kcal: Number(it.kcal) || 0,
          protein: it.protein || 0, fat: it.fat || 0, carb: it.carb || 0
        }));
        this.state.meals.push(...rows);
        return { data: rows, guest: true };
      }
      const rows = items.map(it => ({
        log_date: date, meal_slot: slot, food_name: it.name,
        grams: it.grams, kcal: it.kcal,
        protein: it.protein || 0, fat: it.fat || 0, carb: it.carb || 0,
        owner_name: this.session && this.session.user && this.session.user.name || null
      }));
      try {
        const r = await db.from('bm_meal_logs').insert(rows).select();
        if (r.error) return { error: r.error.message };
        await this.reloadMeals();
        return { data: r.data };
      } catch (e) { return { error: e.message || '写入失败' }; }
    },

    async reloadMeals() {
      const since = Engine.addDays(Engine.today(), -365);
      const r = await db.from('bm_meal_logs').select('*').gte('log_date', since).order('log_date', { ascending: true });
      if (r.error) return { error: r.error.message };
      this.state.meals = (r.data || []).map(x => ({
        id: x.id, date: x.log_date, slot: x.meal_slot, name: x.food_name,
        grams: Number(x.grams) || 0, kcal: Number(x.kcal) || 0,
        protein: Number(x.protein) || 0, fat: Number(x.fat) || 0, carb: Number(x.carb) || 0
      }));
      return { data: true };
    },

    async deleteMeal(id) {
      if (this.guest) {
        this.state.meals = this.state.meals.filter(m => String(m.id) !== String(id));
        return { data: true, guest: true };
      }
      const r = await db.from('bm_meal_logs').delete().eq('id', id).select();
      if (r.error) return { error: r.error.message };
      await this.reloadMeals();
      return { data: true };
    },

    /* ---------------- 自定义动作 / 食物 / 黑名单 ---------------- */
    async saveCustom(kind, name, payload) {
      if (this.guest) {
        const list = this.state.customs;
        const i = list.findIndex(x => x.kind === kind && x.name === name);
        if (i >= 0) list[i] = { ...list[i], payload: { ...(list[i].payload || {}), ...(payload || {}) } };
        else list.push({ id: gid('c'), kind, name, payload: payload || {} });
        return { data: list[i >= 0 ? i : list.length - 1], guest: true };
      }
      const r = await db.from('bm_custom_items').upsert({
        kind, name, payload: payload || {},
        owner_name: this.session && this.session.user && this.session.user.name || null
      }, { onConflict: 'owner_id,kind,name' }).select();
      if (r.error) return { error: r.error.message };
      await this.reloadCustoms();
      return { data: (r.data || [])[0] };
    },

    async deleteCustom(id) {
      if (this.guest) {
        this.state.customs = this.state.customs.filter(x => String(x.id) !== String(id));
        return { data: true, guest: true };
      }
      const r = await db.from('bm_custom_items').delete().eq('id', id).select();
      if (r.error) return { error: r.error.message };
      await this.reloadCustoms();
      return { data: true };
    },

    async reloadCustoms() {
      const r = await db.from('bm_custom_items').select('*').order('created_at', { ascending: true });
      if (r.error) return { error: r.error.message };
      this.state.customs = (r.data || []).map(x => ({ id: x.id, kind: x.kind, name: x.name, payload: x.payload || {} }));
      return { data: true };
    },

    listCustom(kind) {
      return this.state.customs.filter(x => x.kind === kind);
    },

    isBlocked(kind, name) {
      return this.state.customs.some(x => x.kind === kind && x.name === name);
    },

    async block(kind, name) {
      return this.saveCustom(kind, name, { blocked: true });
    },

    async unblock(id) {
      return this.deleteCustom(id);
    }
  };

  window.Store = Store;
})();
