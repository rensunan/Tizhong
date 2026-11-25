/* 本地演示数据层：仅在 localhost / file 打开时启用，数据留在本浏览器，不写云端 */
(function () {
  const DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.protocol === 'file:';
  if (!DEMO) return;

  const KEY = 'bm_demo_v2';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  let D = load() || { profile: null, weights: [], workouts: [], meals: [], customs: [] };
  if (!D.weights) D.weights = [];
  if (!D.customs) D.customs = [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { /* 忽略配额 */ } };
  let seq = 10000;
  const nid = () => ++seq;

  window.Store = {
    state: D,
    session: { user: { name: '本地演示' } },
    online: false,
    demo: true,
    lastError: '',
    init() { return true; },
    async restore() { return this.session; },
    async loadAll() { this.state = D; return { data: true }; },
    userLabel() { return '本地演示'; },
    listCustom(kind) { return D.customs.filter(x => x.kind === kind); },
    isBlocked(kind, name) { return D.customs.some(x => x.kind === kind && x.name === name); },
    async saveProfile(patch) {
      const cur = D.profile || {};
      D.profile = Object.assign({}, cur, patch, { id: cur.id || 1 });
      save(); return { data: D.profile };
    },
    async logWeight(date, kg, waist, note) {
      const ex = D.weights.find(w => w.date === date);
      if (ex) { ex.weight = kg; ex.waist = waist || null; }
      else D.weights.push({ id: nid(), date: date, weight: kg, waist: waist || null, note: note || '' });
      D.weights.sort((a, b) => a.date < b.date ? -1 : 1);
      save(); return { data: true };
    },
    async deleteWeight(id) {
      D.weights = D.weights.filter(w => w.id !== id); save(); return { data: true };
    },
    async addWorkout(date, name, min, kcal) {
      D.workouts.push({ id: nid(), date: date, name: name, minutes: min, kcal: kcal, done: true });
      save(); return { data: true };
    },
    async deleteWorkout(id) {
      D.workouts = D.workouts.filter(w => w.id !== id); save(); return { data: true };
    },
    async addMeal(date, slot, item) {
      D.meals.push({
        id: nid(), date: date, slot: slot, name: item.name, grams: item.grams, kcal: item.kcal,
        protein: item.protein || 0, fat: item.fat || 0, carb: item.carb || 0
      });
      save(); return { data: true };
    },
    async addMeals(date, slot, items) {
      (items || []).forEach(item => {
        D.meals.push({
          id: nid(), date: date, slot: slot, name: item.name, grams: item.grams, kcal: item.kcal,
          protein: item.protein || 0, fat: item.fat || 0, carb: item.carb || 0
        });
      });
      save(); return { data: true };
    },
    async deleteMeal(id) {
      D.meals = D.meals.filter(m => m.id !== id); save(); return { data: true };
    },
    async saveCustom(kind, name, payload) {
      const ex = D.customs.find(c => c.kind === kind && c.name === name);
      if (ex) ex.payload = payload;
      else D.customs.push({ id: nid(), kind: kind, name: name, payload: payload || {} });
      save(); return { data: true };
    },
    async deleteCustom(id) {
      D.customs = D.customs.filter(c => c.id !== id); save(); return { data: true };
    },
    async block(kind, name) { return this.saveCustom(kind, name, { blocked: true }); },
    async unblock(id) { return this.deleteCustom(id); },
    async signOut() {
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      location.reload();
    }
  };
})();
