/* 计算引擎：纯函数，不碰 DOM、不碰网络 */
(function () {
  const KCAL_PER_KG = 7700;

  function round1(n) { return Math.round(n * 10) / 10; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) { const p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function today() { return toISO(new Date()); }

  /* ---------- 基础代谢与消耗 ---------- */
  function bmr(p) {
    const w = Number(p.weight) || 60, h = Number(p.height) || 170;
    const age = p.birthYear ? Math.max(14, new Date().getFullYear() - Number(p.birthYear)) : 28;
    const base = 10 * w + 6.25 * h - 5 * age;
    return p.gender === 'female' ? base - 161 : base + 5;
  }

  const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };

  function tdee(p) {
    return bmr(p) * (ACTIVITY[p.activity] || 1.375);
  }

  /* ---------- 目标可行性 ---------- */
  function plan(p) {
    const s = String(p.startDate || today());
    const t = String(p.targetDate || addDays(s, 90));
    const w0 = Number(p.startWeight) || 60;
    const w1 = Number(p.targetWeight) || 60;
    const deltaW = w1 - w0;
    const days = Math.max(1, daysBetween(s, t));
    const dir = deltaW < 0 ? 'cut' : (deltaW > 0 ? 'bulk' : 'maintain');
    const totalKcal = Math.abs(deltaW) * KCAL_PER_KG;
    const rawDaily = totalKcal / days;

    const base = { dir, deltaW, days, w0, w1, rawDaily, warnings: [] };
    base.bmr = bmr({ ...p, weight: w0 });
    base.tdee = tdee({ ...p, weight: w0 });

    if (dir === 'maintain') {
      base.deficit = 0;
      base.targetIntake = base.tdee;
      base.safe = true;
      return base;
    }

    const cap = dir === 'cut' ? 750 : 500;
    const deficit = Math.min(rawDaily, cap);
    const floor = dir === 'cut' ? (p.gender === 'female' ? 1200 : 1500) : 0;
    let intake = dir === 'cut' ? base.tdee - deficit : base.tdee + deficit;

    if (dir === 'cut' && intake < floor) {
      intake = floor;
      base.warnings.push('按当前期限需要每天只吃 ' + Math.round(base.tdee - deficit) +
        ' kcal，已低于安全下限，方案按 ' + floor + ' kcal 执行，进度会比计划慢。');
    }
    if (dir === 'cut' && intake < base.bmr * 0.85) {
      base.warnings.push('目标摄入已低于基础代谢，长期这么吃代谢会掉、肌肉会流失，建议把期限拉长。');
    }
    if (dir === 'bulk' && rawDaily > 500) {
      base.warnings.push('按当前期限需要每天多吃 ' + Math.round(rawDaily) + ' kcal，超出健康盈余上限，多出来的基本会变成脂肪。');
    }

    // 健康速率：减重 <= 体重 1%/周，增重 <= 0.5%/周
    const perWeek = Math.abs(deltaW) / days * 7;
    const rateCap = dir === 'cut' ? w0 * 0.01 : w0 * 0.005;
    base.perWeek = round1(perWeek * 100) / 100;
    base.rateCap = round1(rateCap * 100) / 100;
    base.tooFast = perWeek > rateCap * 1.05;
    if (base.tooFast) {
      const needDays = Math.ceil(Math.abs(deltaW) / rateCap * 7);
      base.suggestDate = addDays(s, needDays);
      base.suggestDays = needDays;
      base.warnings.push('计划速率 ' + base.perWeek + ' kg/周 超过健康上限 ' + base.rateCap +
        ' kg/周。按健康速率，这个目标至少需要 ' + needDays + ' 天，即 ' + base.suggestDate + '。');
    }

    base.deficit = Math.round(dir === 'cut' ? base.tdee - intake : intake - base.tdee);
    base.targetIntake = Math.round(intake);
    base.safe = base.warnings.length === 0;
    return base;
  }

  /* ---------- 体重趋势 ---------- */
  function movingAvg(logs, win) {
    const w = win || 7;
    const sorted = [...logs].sort((a, b) => a.date < b.date ? -1 : 1);
    return sorted.map((row, i) => {
      const from = Math.max(0, i - w + 1);
      const slice = sorted.slice(from, i + 1);
      const avg = slice.reduce((s, x) => s + Number(x.weight), 0) / slice.length;
      return { date: row.date, weight: Number(row.weight), avg: round1(avg) };
    });
  }

  function slope(points) {
    // points: [{date, weight}] 已按日期升序，x = 距首日天数
    if (points.length < 2) return 0;
    const x0 = parseISO(points[0].date).getTime();
    const xs = points.map(p => (parseISO(p.date).getTime() - x0) / 86400000);
    const ys = points.map(p => p.weight);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den === 0 ? 0 : num / den;
  }

  function progress(logs, p) {
    const pl = plan(p);
    const ma = movingAvg(logs);
    const last = ma.length ? ma[ma.length - 1] : null;
    const current = last ? last.avg : Number(p.startWeight) || 0;
    const totalNeed = Math.abs(pl.w1 - pl.w0);
    const done = Math.abs(current - pl.w0);
    const pct = totalNeed === 0 ? 100 : clamp(done / totalNeed * 100, 0, 100);

    const recent = ma.filter(x => daysBetween(x.date, today()) < 14);
    const k = recent.length >= 3 ? slope(recent.map(x => ({ date: x.date, weight: x.avg }))) : slope(ma.map(x => ({ date: x.date, weight: x.avg })));
    let eta = null, etaNote = '';
    if (Math.abs(k) > 0.001) {
      const remain = pl.w1 - current;
      const d = remain / k;
      if (d > 0 && d < 2000) eta = addDays(today(), Math.ceil(d));
      else if (d <= 0) etaNote = '按当前趋势，方向与目标相反';
    }
    const startIso = String(p.startDate || today());
    const remainDays = daysBetween(today(), p.targetDate || today());
    const elapsed = clamp(daysBetween(startIso, today()), 0, pl.days);
    const idealNow = pl.w0 + pl.deltaW * (elapsed / pl.days);
    return {
      plan: pl, series: ma, current, last, pct, slope: k, eta, etaNote,
      remainDays, idealNow: round1(idealNow),
      gap: round1(current - idealNow),
      startWeight: pl.w0, target: pl.w1
    };
  }

  /* ---------- 训练量换算 ---------- */
  function kcalOf(met, weightKg, minutes) {
    return Math.round(met * (weightKg || 60) * (minutes / 60));
  }

  function estimateMinutes(item) {
    if (item.min) return Number(item.min);
    if (item.sets) return Math.round(Number(item.sets) * 2.2 + 3);
    return 8;
  }

  /* ---------- 训练排期 ---------- */
  const WEEK_PATTERN = {
    1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 6],
    5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [1, 2, 3, 4, 5, 6, 7]
  };

  function scheduleWeek(tpl, freqMode, freqCount, baseDate) {
    const todayIso = baseDate || today();
    const dow = parseISO(todayIso).getDay() || 7; // 1-7
    const monday = addDays(todayIso, 1 - dow);
    const out = [];
    const sch = (tpl && tpl.schedule) || [];
    if (!sch.length) return out;

    if (freqMode === 'monthly') {
      const gap = Math.max(1, Math.round(30 / Math.max(1, freqCount)));
      const anchor = '2026-01-01';
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i);
        const off = daysBetween(anchor, d);
        if (off % gap === 0) {
          out.push({ date: d, ...sch[Math.floor(off / gap) % sch.length] });
        }
      }
      return out;
    }

    const days = WEEK_PATTERN[clamp(freqCount, 1, 7)] || WEEK_PATTERN[3];
    days.forEach((d, i) => {
      out.push({ date: addDays(monday, d - 1), ...sch[i % sch.length] });
    });
    return out;
  }

  function todaySession(tpl, freqMode, freqCount, dateIso) {
    const week = scheduleWeek(tpl, freqMode, freqCount, dateIso);
    const hit = week.find(x => x.date === dateIso);
    return hit || null;
  }

  /* 把「按周 N 天 / 按月 N 次」统一换算成一周里练哪几天 */
  function planFreqInfo(tpl, freqMode, freqCount) {
    const t = tpl || {};
    const mode = freqMode === 'monthly' ? 'monthly' : 'weekly';
    if (mode === 'monthly') {
      const n = clamp(Number(freqCount) || t.daysPerMonth || (t.daysPerWeek || 3) * 4, 1, 31);
      const perWeek = clamp(Math.round(n / 4), 1, 7);
      return { mode, count: n, perWeek, days: WEEK_PATTERN[perWeek] || WEEK_PATTERN[3], unit: 'month' };
    }
    const n = clamp(Number(freqCount) || t.daysPerWeek || 3, 1, 7);
    return { mode, count: n, perWeek: n, days: WEEK_PATTERN[n] || WEEK_PATTERN[3], unit: 'week' };
  }

  /* ---------- 有图白名单：方案只从「有示范图」的动作里排 ---------- */
  let _imgNames = null;
  function mediaNames() {
    if (_imgNames) return _imgNames;
    const s = new Set();
    (window.EXERCISES || []).forEach(e => {
      const local = (window.EX_MEDIA && window.EX_MEDIA[e.id]) || [];
      const cdn = (window.EX_CDN && window.EX_CDN[e.id]) || [];
      if (local.length || cdn.length) s.add(e.name);
    });
    _imgNames = s;
    return s;
  }
  function hasMedia(name) { return mediaNames().has(name); }

  /* 把模板摊成「周一到周日」的固定计划；训练日超出模板天数时循环取用 */
  function buildWeekPlan(tpl, freqMode, freqCount) {
    const out = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    const sch = (tpl && tpl.schedule) || [];
    if (!sch.length) return out;
    const info = planFreqInfo(tpl, freqMode, freqCount);
    info.days.forEach((d, i) => {
      // 无示范图的动作不进计划；整天都被剔掉就顺延到下一个训练日，保证训练日数量不变
      for (let k = 0; k < sch.length; k++) {
        const day = sch[(i + k) % sch.length];
        const items = day.items.filter(it => hasMedia(it.n)).map(it => ({ ...it }));
        if (items.length) { out[d] = items; break; }
      }
    });
    return out;
  }

  /* ---------- 食物配量 ---------- */
  const SLOT_WEIGHT = {
    b: { staple: 0.35, protein: 0.40, veg: 0.10, fruit: 0.15, nut: 0 },
    l: { staple: 0.40, protein: 0.35, veg: 0.25, fruit: 0, nut: 0 },
    d: { staple: 0.28, protein: 0.42, veg: 0.30, fruit: 0, nut: 0 },
    s: { staple: 0, protein: 0.15, veg: 0, fruit: 0.50, nut: 0.35 }
  };

  /* 没写 hand 的食材按分类给一个兜底量词，保证永远能量化 */
  const DEFAULT_HAND = {
    staple: { u: '拳', g: 120 }, grain: { u: '拳', g: 150 },
    protein: { u: '巴掌', g: 120 },
    veg: { u: '拳', g: 100 }, fruit: { u: '个', g: 150 },
    nut: { u: '把', g: 20 }, combo: { u: '份', g: 300 }
  };

  function portion(foods, targetKcal, slot) {
    if (!foods.length) return { items: [], total: 0, target: targetKcal, diff: 0 };

    const combo = foods.filter(f => f.cat === 'combo');
    if (combo.length) {
      const items = combo.map(f => {
        const grams = f.g;
        const kcal = Math.round(f.kcal * grams / 100);
        const h = f.hand || DEFAULT_HAND.combo;
        return { id: f.id, name: f.name, cat: f.cat, grams, kcal, unit: f.unit,
          hand: h, qty: Math.max(0.5, Math.round(grams / h.g * 2) / 2),
          protein: round1(f.p * grams / 100), fat: round1(f.f * grams / 100), carb: round1(f.c * grams / 100), portions: 1 };
      });
      const total = items.reduce((s, x) => s + x.kcal, 0);
      return { items, total, target: targetKcal, diff: total - targetKcal, isCombo: true };
    }

    const groups = {};
    foods.forEach(f => {
      const key = f.cat === 'grain' ? 'staple' : f.cat;
      (groups[key] = groups[key] || []).push(f);
    });

    const w = { ...(SLOT_WEIGHT[slot] || SLOT_WEIGHT.l) };
    const BASE_W = { staple: 0.30, protein: 0.30, veg: 0.20, fruit: 0.15, nut: 0.10 };
    let sum = 0;
    Object.keys(w).forEach(k => {
      if (!groups[k] || !groups[k].length) { w[k] = 0; return; }
      if (!w[k]) w[k] = BASE_W[k] || 0.1;
      sum += w[k];
    });
    if (sum === 0) return { items: [], total: 0, target: targetKcal, diff: 0 };

    const items = [];
    Object.keys(w).forEach(cat => {
      if (!w[cat]) return;
      const share = targetKcal * (w[cat] / sum);
      const list = groups[cat];
      const per = share / list.length;
      list.forEach(f => {
        let grams = (per / f.kcal) * 100;
        const step = cat === 'veg' ? 10 : 5;
        grams = Math.round(grams / step) * step;
        const minG = cat === 'veg' ? 50 : (cat === 'nut' ? 10 : 25);
        const maxG = cat === 'veg' ? 300 : (cat === 'nut' ? 40 : (cat === 'fruit' ? 300 : 250));
        grams = clamp(grams, minG, maxG);
        const h = f.hand || DEFAULT_HAND[cat] || { u: '份', g: 100 };
        items.push({
          id: f.id, name: f.name, cat: f.cat, grams, unit: f.unit,
          hand: h, qty: Math.max(0.5, Math.round(grams / h.g * 2) / 2),
          portions: round1(grams / (f.g || 100)),
          kcal: Math.round(f.kcal * grams / 100),
          protein: round1(f.p * grams / 100),
          fat: round1(f.f * grams / 100),
          carb: round1(f.c * grams / 100)
        });
      });
    });

    const total = items.reduce((s, x) => s + x.kcal, 0);
    return { items, total, target: targetKcal, diff: total - targetKcal };
  }

  /* ---------- 过滤：忌口 / 饮食方式 / 场景 ---------- */
  function foodAllowed(f, opts) {
    const avoid = opts.avoid || [];
    if (f.tags && f.tags.some(t => avoid.includes(t))) return false;
    if (opts.diet === 'veg') {
      if (f.tags && (f.tags.includes('猪肉') || f.tags.includes('牛羊肉') || f.tags.includes('海鲜'))) return false;
    }
    if (opts.scene && opts.scene !== 'all' && f.scene !== 'any' && f.scene !== opts.scene) return false;
    return true;
  }

  function exerciseAllowed(e, opts) {
    const equip = opts.equipment || ['none'];
    if (!equip.includes(e.equip) && e.equip !== 'none') return false;
    if (opts.limitations && opts.limitations.length) {
      if (opts.limitations.includes('knee') && e.impact === 'high') return false;
      if (opts.limitations.includes('knee') && e.muscle === 'legs' && e.impact === 'mid' && e.level === 3) return false;
      if (opts.limitations.includes('back') && ['杠铃硬拉', '杠铃划船'].includes(e.name)) return false;
      if (opts.limitations.includes('shoulder') && ['杠铃肩推', '双杠臂屈伸'].includes(e.name)) return false;
    }
    if (opts.blacklist && opts.blacklist.includes(e.name)) return false;
    return true;
  }

  window.Engine = {
    KCAL_PER_KG, round1, clamp, pad, toISO, parseISO, daysBetween, addDays, today,
    bmr, tdee, plan, movingAvg, slope, progress, kcalOf, estimateMinutes,
    scheduleWeek, todaySession, buildWeekPlan, planFreqInfo, mediaNames, hasMedia, portion, foodAllowed, exerciseAllowed, ACTIVITY
  };
})();
