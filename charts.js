/* 手写 SVG 图表，不依赖任何外部库，离线可用 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const C = {
    line: '#0e9f6e', point: '#0e9f6e', avg: '#0b7d57',
    plan: '#94a3b8', target: '#f97316', grid: '#e6ecea',
    ink: '#5b6b67', trace: '#cbd5d2', intake: '#f0a04b', burn: '#4aa3a0'
  };

  function el(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function empty(host, msg) {
    host.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'chart-empty';
    d.textContent = msg;
    host.appendChild(d);
  }

  function svgRoot(w, h) {
    const s = el('svg', { viewBox: `0 0 ${w} ${h}`, width: '100%', preserveAspectRatio: 'xMidYMid meet' });
    s.setAttribute('class', 'chart-svg');
    return s;
  }

  /* ---------- 体重折线 ---------- */
  function weightChart(host, opts) {
    const series = (opts.series || []).filter(x => x && x.date);
    if (series.length < 1) { empty(host, '还没有体重记录，先打个卡，这里就会长出曲线'); return; }

    const W = 700, H = 250, padL = 46, padR = 18, padT = 18, padB = 30;
    const last = series[series.length - 1].date;
    const range = opts.range || 30;
    const xMin = range ? Engine.addDays(last, -range + 1) : series[0].date;
    const xMax = last;
    const totalDays = Math.max(1, Engine.daysBetween(xMin, xMax));

    const plan = opts.plan;
    const startDate = opts.startDate, targetDate = opts.targetDate;

    const planAt = (d) => {
      if (!plan || !startDate || !targetDate) return null;
      const tot = Engine.daysBetween(startDate, targetDate);
      if (tot <= 0) return null;
      const off = Engine.daysBetween(startDate, d) / tot;
      if (off < -0.05 || off > 1.05) return null;
      return plan.w0 + plan.deltaW * Engine.clamp(off, 0, 1);
    };

    const vals = [];
    series.filter(p => p.date >= xMin).forEach(s => { vals.push(s.weight); vals.push(s.avg); });
    const pv1 = planAt(xMin), pv2 = planAt(xMax);
    if (pv1 != null) vals.push(pv1);
    if (pv2 != null) vals.push(pv2);
    if (!vals.length) vals.push(70);
    let yMin = Math.min(...vals), yMax = Math.max(...vals);
    if (yMax - yMin < 1.5) { const mid = (yMax + yMin) / 2; yMin = mid - 0.75; yMax = mid + 0.75; }
    yMin -= 0.4; yMax += 0.4;

    const x = d => padL + (Engine.daysBetween(xMin, d) / totalDays) * (W - padL - padR);
    const y = v => padT + (yMax - v) / (yMax - yMin) * (H - padT - padB);

    const s = svgRoot(W, H);

    // 网格 + y 轴
    for (let i = 0; i <= 3; i++) {
      const v = yMin + (yMax - yMin) * i / 3;
      const yy = y(v);
      s.appendChild(el('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, stroke: C.grid, 'stroke-width': 1 }));
      s.appendChild(el('text', { x: padL - 8, y: yy + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.ink }, v.toFixed(1)));
    }

    // 计划线
    if (plan && startDate && targetDate) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const d = Engine.addDays(xMin, Math.round(totalDays * i / 40));
        const p = planAt(d);
        if (p != null) pts.push(`${x(d)},${y(p)}`);
      }
      if (pts.length > 1) {
        s.appendChild(el('polyline', {
          points: pts.join(' '), fill: 'none', stroke: C.plan,
          'stroke-width': 1.6, 'stroke-dasharray': '5 4'
        }));
      }
    }

    // 目标横线
    if (plan && plan.w1 >= yMin && plan.w1 <= yMax) {
      s.appendChild(el('line', {
        x1: padL, y1: y(plan.w1), x2: W - padR, y2: y(plan.w1),
        stroke: C.target, 'stroke-width': 1.4, 'stroke-dasharray': '2 3'
      }));
      s.appendChild(el('text', { x: W - padR, y: y(plan.w1) - 6, 'text-anchor': 'end', 'font-size': 11, fill: C.target }, '目标 ' + plan.w1 + 'kg'));
    }

    const inRange = series.filter(p => p.date >= xMin);

    // 实测折线
    if (inRange.length > 1) {
      s.appendChild(el('polyline', {
        points: inRange.map(p => `${x(p.date)},${y(p.weight)}`).join(' '),
        fill: 'none', stroke: C.line, 'stroke-width': 1.2, opacity: 0.45
      }));
    }
    inRange.forEach(p => {
      const c = el('circle', { cx: x(p.date), cy: y(p.weight), r: 2.6, fill: C.point, opacity: 0.75 });
      c.appendChild(el('title', {}, `${p.date}  ${p.weight} kg`));
      s.appendChild(c);
    });

    // 7 日均线
    if (inRange.length > 1) {
      const pts = inRange.map(p => `${x(p.date)},${y(p.avg)}`).join(' ');
      // 面积渐变填充
      const defs = el('defs', {});
      const grad = el('linearGradient', { id: 'avgFill', x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el('stop', { offset: '0%', 'stop-color': C.avg, 'stop-opacity': 0.22 }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': C.avg, 'stop-opacity': 0 }));
      defs.appendChild(grad);
      s.appendChild(defs);
      const baseY = H - padB;
      const areaPts = `${x(inRange[0].date)},${baseY} ` + pts + ` ${x(inRange[inRange.length - 1].date)},${baseY}`;
      s.appendChild(el('polygon', { points: areaPts, fill: 'url(#avgFill)' }));
      s.appendChild(el('polyline', { points: pts, fill: 'none', stroke: C.avg, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }));
      const lp = inRange[inRange.length - 1];
      s.appendChild(el('circle', { cx: x(lp.date), cy: y(lp.avg), r: 4, fill: '#fff', stroke: C.avg, 'stroke-width': 2.4 }));
    }

    // 趋势预测
    const p = opts.progress;
    if (p && Math.abs(p.slope) > 0.001 && inRange.length >= 3) {
      const lp = inRange[inRange.length - 1];
      const ahead = Math.min(range === 7 ? 7 : 30, Math.abs((plan ? plan.w1 - p.current : 5) / p.slope) || 30);
      const endD = Engine.addDays(lp.date, Math.ceil(ahead));
      const endV = p.current + p.slope * ahead;
      const x2 = padL + (Engine.daysBetween(xMin, endD) / totalDays) * (W - padL - padR);
      if (x2 <= W - padR + 1) {
        s.appendChild(el('line', {
          x1: x(lp.date), y1: y(p.current), x2, y2: y(endV),
          stroke: C.trace, 'stroke-width': 2, 'stroke-dasharray': '3 4'
        }));
        s.appendChild(el('text', { x: x2, y: y(endV) - 8, 'text-anchor': 'end', 'font-size': 11, fill: C.trace }, '按此趋势'));
      }
    }

    // x 轴
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const d = Engine.addDays(xMin, Math.round(totalDays * i / ticks));
      s.appendChild(el('text', {
        x: padL + (W - padL - padR) * i / ticks, y: H - 8,
        'text-anchor': i === 0 ? 'start' : (i === ticks ? 'end' : 'middle'),
        'font-size': 11, fill: C.ink
      }, d.slice(5)));
    }

    host.innerHTML = '';
    host.appendChild(s);
  }

  /* ---------- 热量进出柱状 ---------- */
  function calorieChart(host, rows, targetIntake) {
    if (!rows.length) { empty(host, '记录三餐和训练后，这里会显示每日热量进出'); return; }
    const W = 700, H = 220, padL = 42, padR = 14, padT = 16, padB = 30;
    const maxV = Math.max(targetIntake || 0, ...rows.map(r => Math.max(r.intake, r.burn)), 1) * 1.15;
    const bw = Math.min(18, (W - padL - padR) / rows.length / 3);
    const step = (W - padL - padR) / rows.length;
    const y = v => padT + (1 - v / maxV) * (H - padT - padB);
    const s = svgRoot(W, H);

    for (let i = 0; i <= 3; i++) {
      const v = maxV * i / 3;
      s.appendChild(el('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: C.grid, 'stroke-width': 1 }));
      s.appendChild(el('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.ink }, Math.round(v)));
    }

    rows.forEach((r, i) => {
      const cx = padL + step * (i + 0.5);
      const hi = H - padB - y(r.intake);
      const hb = H - padB - y(r.burn);
      if (r.intake > 0) {
        const rect = el('rect', { x: cx - bw - 2, y: y(r.intake), width: bw, height: Math.max(1, hi), rx: 3, fill: C.intake, opacity: 0.9 });
        rect.appendChild(el('title', {}, `${r.date}  摄入 ${Math.round(r.intake)} kcal`));
        s.appendChild(rect);
      }
      if (r.burn > 0) {
        const rect = el('rect', { x: cx + 2, y: y(r.burn), width: bw, height: Math.max(1, hb), rx: 3, fill: C.burn, opacity: 0.9 });
        rect.appendChild(el('title', {}, `${r.date}  消耗 ${Math.round(r.burn)} kcal`));
        s.appendChild(rect);
      }
      if (rows.length <= 14 || i % Math.ceil(rows.length / 10) === 0) {
        s.appendChild(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: C.ink }, r.date.slice(5)));
      }
    });

    if (targetIntake) {
      s.appendChild(el('line', {
        x1: padL, y1: y(targetIntake), x2: W - padR, y2: y(targetIntake),
        stroke: C.target, 'stroke-width': 1.4, 'stroke-dasharray': '4 3'
      }));
      s.appendChild(el('text', { x: W - padR, y: y(targetIntake) - 6, 'text-anchor': 'end', 'font-size': 11, fill: C.target }, '目标 ' + Math.round(targetIntake)));
    }

    host.innerHTML = '';
    host.appendChild(s);
  }

  /* ---------- 热量环 ---------- */
  function ring(host, value, max, label, sub) {
    const size = 168, r = 62, cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const pct = max > 0 ? Engine.clamp(value / max, 0, 1) : 0;
    const s = svgRoot(size, size);
    s.setAttribute('class', 'ring-svg');

    const defs = el('defs', {});
    const grad = el('linearGradient', { id: 'ringGrad', x1: 0, y1: 0, x2: 1, y2: 1 });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#1ec98a' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#0b8f63' }));
    defs.appendChild(grad);
    s.appendChild(defs);

    s.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: '#edf2f0', 'stroke-width': 13 }));
    s.appendChild(el('circle', {
      cx, cy, r, fill: 'none',
      stroke: pct > 1 ? '#e11d48' : (pct > 0.9 ? '#f97316' : 'url(#ringGrad)'),
      'stroke-width': 13, 'stroke-linecap': 'round',
      'stroke-dasharray': `${circ * Math.min(pct, 1)} ${circ}`,
      transform: `rotate(-90 ${cx} ${cy})`
    }));
    s.appendChild(el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', 'font-size': 30, 'font-weight': 700, fill: '#12211d', 'letter-spacing': '-0.5' }, Math.round(value)));
    s.appendChild(el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', 'font-size': 11, fill: '#7b8b86' }, label || '已摄入 kcal'));
    if (sub) s.appendChild(el('text', { x: cx, y: cy + 34, 'text-anchor': 'middle', 'font-size': 10, fill: '#a8b5b1' }, sub));

    host.innerHTML = '';
    host.appendChild(s);
  }

  /* ---------- 打卡热力图 ---------- */
  function heatmap(host, dates, weeks) {
    const set = new Set(dates);
    const wk = weeks || 12, cell = 15, gap = 3;
    const W = wk * (cell + gap) + 26, H = 7 * (cell + gap) + 20;
    const s = svgRoot(W, H);
    const today = Engine.today();
    const dow = new Date().getDay() || 7;
    const thisMonday = Engine.addDays(today, -(dow - 1));
    const start = Engine.addDays(thisMonday, -(wk - 1) * 7);

    for (let w = 0; w < wk; w++) {
      for (let d = 0; d < 7; d++) {
        const date = Engine.addDays(start, w * 7 + d);
        if (date > today) continue;
        const on = set.has(date);
        const c = el('rect', {
          x: 20 + w * (cell + gap), y: 4 + d * (cell + gap),
          width: cell, height: cell, rx: 3,
          fill: on ? '#0e9f6e' : '#eef3f1'
        });
        c.appendChild(el('title', {}, date + (on ? '  已打卡' : '  未打卡')));
        s.appendChild(c);
      }
    }
    ['一', '三', '五', '日'].forEach((t, i) => {
      s.appendChild(el('text', { x: 6, y: 12 + (i * 2) * (cell + gap) + 8, 'font-size': 9, fill: '#a8b5b1' }, t));
    });
    host.innerHTML = '';
    host.appendChild(s);
  }

  /* ---------- 迷你双轴对比条 ---------- */
  function miniBars(host, items) {
    if (!items.length) { empty(host, '暂无数据'); return; }
    const max = Math.max(...items.map(i => i.value), 1);
    host.innerHTML = items.map(i => `
      <div class="mini-row">
        <span class="mini-label">${i.label}</span>
        <span class="mini-track"><i style="width:${Math.round(i.value / max * 100)}%;background:${i.color || '#0e9f6e'}"></i></span>
        <span class="mini-value">${i.text}</span>
      </div>`).join('');
  }

  window.Charts = { weightChart, calorieChart, ring, heatmap, miniBars, empty };
})();
