/* 滚轮选择器：弹层 + 上下滑动 + 吸附，支持多列 */
(function () {
  const ITEM_H = 44;
  let root = null;
  let state = null;

  function paint(ci) {
    const col = root.querySelectorAll('.picker-col')[ci];
    if (!col) return;
    const idx = state.indexes[ci];
    col.querySelectorAll('.picker-item').forEach((n, i) => {
      n.classList.toggle('on', i === idx);
    });
  }

  function onScroll(colEl, ci) {
    const idx = Math.round(colEl.scrollTop / ITEM_H);
    const max = state.cols[ci].items.length - 1;
    const i = Math.max(0, Math.min(max, idx));
    if (i !== state.indexes[ci]) {
      state.indexes[ci] = i;
      paint(ci);
    }
  }

  function close() {
    if (root) root.innerHTML = '';
    state = null;
  }

  function open(opts) {
    close();
    root = document.getElementById('picker-root');
    const cols = opts.columns || [];
    const colHtml = cols.map((c, ci) => `
      <div class="picker-col" data-ci="${ci}">
        <div class="picker-spacer"></div>
        ${c.items.map((it, i) => `<div class="picker-item" data-i="${i}">${it.label}${c.unit ? '<em>' + c.unit + '</em>' : ''}</div>`).join('')}
        <div class="picker-spacer"></div>
      </div>`).join('');

    root.innerHTML = `
      <div class="sheet-mask picker-mask">
        <div class="sheet picker-sheet" data-pk="panel">
          <div class="sheet-head">
            <button class="btn btn-mini" data-pk="cancel">取消</button>
            <div class="sheet-title">${opts.title || ''}</div>
            <button class="btn btn-mini btn-primary" data-pk="ok">确定</button>
          </div>
          <div class="picker-body">
            <div class="picker-highlight"></div>
            <div class="picker-cols">${colHtml}</div>
          </div>
        </div>
      </div>`;

    state = { cols, indexes: cols.map(c => Math.max(0, Math.min((c.items.length - 1), c.index || 0))), onConfirm: opts.onConfirm };

    root.querySelectorAll('.picker-col').forEach((colEl, ci) => {
      colEl.addEventListener('scroll', () => onScroll(colEl, ci), { passive: true });
      colEl.addEventListener('click', e => {
        const it = e.target.closest('.picker-item');
        if (!it) return;
        const i = Number(it.dataset.i);
        colEl.scrollTo({ top: i * ITEM_H, behavior: 'smooth' });
      });
    });

    requestAnimationFrame(() => {
      root.querySelectorAll('.picker-col').forEach((colEl, ci) => {
        colEl.scrollTop = state.indexes[ci] * ITEM_H;
        paint(ci);
      });
    });

    root.onclick = e => {
      const btn = e.target.closest('[data-pk]');
      if (!btn) return;
      const act = btn.dataset.pk;
      if (act === 'cancel') { close(); return; }
      if (act === 'mask') {
        if (e.target.classList.contains('picker-mask')) close();
        return;
      }
      if (act === 'ok') {
        const vals = {};
        state.cols.forEach((c, ci) => {
          const item = c.items[state.indexes[ci]];
          vals[c.key] = item ? item.value : null;
        });
        const cb = state.onConfirm;
        close();
        if (cb) cb(vals);
      }
    };
  }

  window.Picker = { open, close, ITEM_H };
})();
