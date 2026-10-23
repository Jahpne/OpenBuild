/* storage.js — every piece of persistent state lives here (localStorage only).
   Shape is versioned and merged with defaults so new fields never crash old saves. */
const Store = (() => {
  const KEY = 'slicenaira.v1';
  const DEFAULTS = {
    wallet: 0,
    bests: {},              // levelIndex -> best score
    bestEndless: 0,
    levelStars: {},         // levelIndex -> 0..3
    unlockedLevel: 1,       // 1-based highest unlocked level (11 = endless)
    runsPlayed: 0,
    streak: { count: 0, last: null, claimedOn: null },   // login streak
    daily: { day: null, attempted: false, best: 0, m: {}, claimed: {} },
    settings: { muted: false, rehab: false, name: 'anon', calibrated: false },
    owned: { trails: ['purple'], skins: ['classic'] },
    equipped: { trail: 'purple', skin: 'classic' },
    leaderboard: [],        // local top 10 (see Leaderboard below)
    rehabHistory: []        // {date, reps, secs, reach:{l,r,u,d}}
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  function merge(d, s) {
    const o = clone(d);
    for (const k in s) {
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] && typeof d[k] === 'object') o[k] = merge(d[k], s[k]);
      else o[k] = s[k];
    }
    return o;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); return raw ? merge(DEFAULTS, JSON.parse(raw)) : clone(DEFAULTS); }
    catch (e) { return clone(DEFAULTS); }
  }
  let data = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn('save failed', e); } }
  return {
    get data() { return data; },
    save,
    reset() { data = clone(DEFAULTS); save(); },
    addWallet(n) { data.wallet += n; save(); },
    spend(n) { if (data.wallet < n) return false; data.wallet -= n; save(); return true; }
  };
})();

/* Leaderboard — local top 10. To go online, keep the same signatures and
   swap the bodies for fetch() calls to FastAPI / Firebase. */
const Leaderboard = {
  top() { return Store.data.leaderboard.slice(0, 10); },
  submit(entry) {               // entry: {name, score, mode, level, date}
    const lb = Store.data.leaderboard;
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    Store.data.leaderboard = lb.slice(0, 10);
    Store.save();
    const idx = Store.data.leaderboard.indexOf(entry);
    return idx + 1;             // 1-based rank, 0 if it fell off the board
  }
};

/* Meta — daily loop: login streak, daily seed, missions. All dates are local. */
const Meta = (() => {
  const pad = n => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayKey(d); };
  const MISSIONS = [
    { id: 's50', label: 'Slice 50 fruits',          need: 50, key: 'slices',   reward: 2000 },
    { id: 'p3',  label: 'Get 3 perfect cuts',       need: 3,  key: 'perfects', reward: 1500 },
    { id: 'c5',  label: 'Land a 5-fruit combo',     need: 1,  key: 'combo5',   reward: 3000 },
    { id: 'b20', label: 'Score ₦20,000 in one run', need: 1,  key: 'big',      reward: 2500 }
  ];
  // Reset per-day counters when the date changes.
  function ensureDay() {
    const D = Store.data.daily, t = dayKey();
    if (D.day !== t) {
      D.day = t; D.attempted = false; D.best = 0;
      D.m = { slices: 0, perfects: 0, combo5: 0, big: 0 };
      D.claimed = {};
      Store.save();
    }
    return D;
  }
  return {
    MISSIONS, todayKey: () => dayKey(), ensureDay,
    checkLogin() {                          // call once on boot
      const S = Store.data.streak, t = dayKey();
      if (S.last === t) return;
      S.count = (S.last === yesterdayKey()) ? S.count + 1 : 1;
      S.last = t; Store.save();
    },
    loginReward() { return Math.min(25000, 5000 + (Store.data.streak.count - 1) * 2500); },
    canClaim() { return Store.data.streak.claimedOn !== dayKey(); },
    claimLogin() {
      if (!this.canClaim()) return 0;
      const amt = this.loginReward();
      Store.data.streak.claimedOn = dayKey();
      Store.addWallet(amt);
      return amt;
    },
    claimMission(id) {
      const D = ensureDay(), m = MISSIONS.find(x => x.id === id);
      if (!m || D.claimed[id]) return 0;
      D.claimed[id] = true; Store.addWallet(m.reward); return m.reward;
    },
    bump(key, n = 1) { const D = ensureDay(); D.m[key] = (D.m[key] || 0) + n; Store.save(); },
    setMax(key, v) { const D = ensureDay(); D.m[key] = Math.max(D.m[key] || 0, v); Store.save(); },
    // YYYYMMDD integer — identical for every player on the same calendar day.
    dailySeed() { return parseInt(dayKey().replace(/-/g, ''), 10); }
  };
})();

/* mulberry32 — tiny seeded PRNG so the Daily run is the same for everyone. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
