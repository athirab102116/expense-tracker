import { db } from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES, SMS_PATTERNS } from './categories.js';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  categories: [],
  merchantRules: [],
  currentMonth: '',          // 'YYYY-MM'
  editingExpense: null,
  filterCategory: null,
  searchQuery: '',
  pictureMode: false,
  chart: null,
  trendChart: null,
  barChart: null,
  storagePersisted: null,    // null=unknown, true=safe, false=at-risk
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function today() {
  // Use local date, not UTC — avoids wrong date for IST users (UTC+5:30)
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}

function fmt(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function parseAmount(str) {
  return parseFloat(String(str).replace(/[^\d.]/g, '')) || 0;
}

function getCat(id) {
  return state.categories.find(c => c.id === id) || { id: 'other', name: 'Other', emoji: '📦', color: '#B2BEC3' };
}

function dateToMonth(dateStr) {
  return dateStr.slice(0, 7);
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
  document.body.style.overflow = '';
}

function closeAllModals() {
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  document.body.style.overflow = '';
}

// ─── Merchant Auto-categorize ────────────────────────────────────────────────
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Returns { categoryId, confident }
async function autoCategory(merchant) {
  if (!merchant) return { categoryId: 'other', confident: false };
  const lower = merchant.toLowerCase();

  // Permanently learned corrections
  const learned = await db.getSetting('learned_merchants', {});
  if (learned[lower]) return { categoryId: learned[lower], confident: true };

  // Editable keyword rules
  const rules = await db.getAll('merchant_rules');
  for (const rule of rules) {
    if (lower.includes(rule.keyword.toLowerCase()))
      return { categoryId: rule.categoryId, confident: true };
  }

  // Pending memory: if we've seen and labelled this merchant within 1 week
  const pending = await db.getSetting('pending_merchants', {});
  if (pending[lower] && pending[lower].categoryId && Date.now() - pending[lower].firstSeen <= WEEK_MS) {
    return { categoryId: pending[lower].categoryId, confident: false };
  }

  return { categoryId: 'other', confident: false };
}

async function learnMerchant(merchant, categoryId) {
  if (!merchant) return;
  const learned = await db.getSetting('learned_merchants', {});
  learned[merchant.toLowerCase()] = categoryId;
  await db.setSetting('learned_merchants', learned);
}

// Pending merchant memory: track uncertain merchants for 1 week
async function recordPendingMerchant(merchant, categoryId) {
  if (!merchant) return;
  const lower = merchant.toLowerCase();
  const pending = await db.getSetting('pending_merchants', {});
  const now = Date.now();
  const entry = pending[lower];

  if (entry && now - entry.firstSeen <= WEEK_MS) {
    entry.count = (entry.count || 1) + 1;
    entry.lastSeen = now;
    if (categoryId) entry.categoryId = categoryId;

    if (entry.count >= 2 && entry.categoryId) {
      // Seen twice in a week → save permanently
      await db.add('merchant_rules', { keyword: lower, categoryId: entry.categoryId });
      state.merchantRules = await db.getAll('merchant_rules');
      delete pending[lower];
      await db.setSetting('pending_merchants', pending);
      showToast(`✨ Saved "${merchant}" → ${getCat(entry.categoryId).emoji} ${getCat(entry.categoryId).name} permanently`);
      return;
    }
  } else {
    // New sighting or expired — start fresh
    pending[lower] = { categoryId, firstSeen: now, lastSeen: now, count: 1 };
  }
  await db.setSetting('pending_merchants', pending);
}

async function cleanupPendingMerchants() {
  const pending = await db.getSetting('pending_merchants', {});
  const now = Date.now();
  let changed = false;
  for (const key of Object.keys(pending)) {
    if (now - pending[key].firstSeen > WEEK_MS) {
      delete pending[key];
      changed = true;
    }
  }
  if (changed) await db.setSetting('pending_merchants', pending);
}

// Show clarification bottom sheet for an expense whose category is uncertain
function showCategoryPrompt(expense) {
  document.getElementById('clarify-merchant').textContent = expense.merchant || 'this expense';
  document.getElementById('clarify-amount').textContent = fmt(expense.amount);

  const grid = document.getElementById('clarify-cats');
  grid.innerHTML = state.categories.map(cat => `
    <div class="cat-pick" data-id="${cat.id}" data-expense-id="${expense.id}">
      <div class="cat-pick-emoji">${cat.emoji}</div>
      <div class="cat-pick-name">${cat.name}</div>
    </div>
  `).join('');

  openModal('clarify-modal');

  grid.querySelectorAll('.cat-pick').forEach(el => {
    el.addEventListener('click', async () => {
      const catId = el.dataset.id;
      const expId = parseInt(el.dataset.expenseId);
      // Update saved expense
      const exp = await db.get('expenses', expId);
      if (exp) { exp.category = catId; await db.put('expenses', exp); }
      // Record for memory
      await recordPendingMerchant(expense.merchant, catId);
      closeModal('clarify-modal');
      showToast(`Saved as ${getCat(catId).emoji} ${getCat(catId).name}`);
      if (state.view === 'dashboard' || state.view === 'transactions') renderView();
    });
  });

  document.getElementById('clarify-skip')?.addEventListener('click', () => {
    closeModal('clarify-modal');
  });
}

// ─── GitHub Gist Sync ────────────────────────────────────────────────────────
let _syncTimer = null;
const GIST_FILENAME = 'expense-tracker.json';
const GIST_DESCRIPTION = 'Expense Tracker Sync';

// Find an existing Gist by searching the user's gists list
async function findExistingGist(token) {
  try {
    const res = await fetch('https://api.github.com/gists?per_page=50', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return null;
    const gists = await res.json();
    const found = gists.find(g =>
      g.description === GIST_DESCRIPTION && g.files[GIST_FILENAME]
    );
    return found?.id || null;
  } catch {
    return null;
  }
}

async function _resolveGistId(token) {
  let gistId = await db.getSetting('github_gist_id', '');
  if (!gistId) {
    // No local Gist ID — search GitHub for an existing one
    gistId = await findExistingGist(token);
    if (gistId) await db.setSetting('github_gist_id', gistId);
  }
  return gistId;
}

async function gistSync() {
  const token = await db.getSetting('github_token', '');
  if (!token) return;

  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    const el = document.getElementById('gist-sync-status');
    try {
      const [expenses, categories, budgets, merchantRules] = await Promise.all([
        db.getAll('expenses'), db.getAll('categories'),
        db.getAll('budgets'), db.getAll('merchant_rules'),
      ]);
      const learnedMerchants = await db.getSetting('learned_merchants', {});
      const pendingMerchants = await db.getSetting('pending_merchants', {});

      const payload = JSON.stringify({
        version: 2, syncedAt: Date.now(),
        expenses, categories, budgets, merchantRules, learnedMerchants, pendingMerchants,
      });

      const gistId = await _resolveGistId(token);
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const body = JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: { [GIST_FILENAME]: { content: payload } },
      });

      const url = gistId
        ? `https://api.github.com/gists/${gistId}`
        : 'https://api.github.com/gists';
      const res = await fetch(url, { method: gistId ? 'PATCH' : 'POST', headers, body });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!gistId) await db.setSetting('github_gist_id', data.id);

      const t = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      await db.setSetting('last_gist_sync', t);
      if (el) el.textContent = `☁️ Synced at ${t}`;

    } catch (err) {
      console.warn('Gist sync failed:', err.message);
      if (el) el.textContent = `⚠️ Sync failed: ${err.message}`;
    }
  }, 1200);
}

async function loadFromGist() {
  const token = await db.getSetting('github_token', '');
  if (!token) return;

  // Resolve Gist ID — search GitHub if not cached locally
  const gistId = await _resolveGistId(token);
  if (!gistId) return;

  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return;

    const gist = await res.json();
    const file = gist.files[GIST_FILENAME];
    if (!file?.content) return;

    const data = JSON.parse(file.content);
    if (!Array.isArray(data.expenses)) return;

    // Gist is the source of truth — replace local data if Gist has content
    if (data.expenses.length > 0) {
      await db.clearStore('expenses');
      for (const e of data.expenses) await db.add('expenses', e);
    }
    if (data.categories?.length) {
      await db.clearStore('categories');
      for (const c of data.categories) await db.put('categories', c);
    }
    if (data.budgets?.length) {
      await db.clearStore('budgets');
      for (const b of data.budgets) await db.put('budgets', b);
    }
    if (data.merchantRules?.length) {
      await db.clearStore('merchant_rules');
      for (const r of data.merchantRules) await db.add('merchant_rules', r);
    }
    if (data.learnedMerchants) await db.setSetting('learned_merchants', data.learnedMerchants);
    if (data.pendingMerchants) await db.setSetting('pending_merchants', data.pendingMerchants);

  } catch (err) {
    console.warn('Gist load failed:', err.message);
  }
}

// ─── SMS Parsing ─────────────────────────────────────────────────────────────
function parseSMS(text) {
  // Try each pattern
  for (const p of SMS_PATTERNS) {
    const m = text.match(p.regex);
    if (m) {
      const amount = parseAmount(m[1] || '0');
      const merchant = (m[2] || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (amount > 0) return { amount, merchant };
    }
  }
  // Fallback: grab first number that looks like an amount
  const fallback = text.match(/(?:₹|INR|Rs\.?)\s*([\d,]+\.?\d*)/i);
  if (fallback) return { amount: parseAmount(fallback[1]), merchant: '' };
  return null;
}

// ─── Data Bootstrap ───────────────────────────────────────────────────────────
async function bootstrap() {
  const cats = await db.getAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) await db.put('categories', c);
  }
  const rules = await db.getAll('merchant_rules');
  if (rules.length === 0) {
    for (const r of DEFAULT_MERCHANT_RULES) await db.add('merchant_rules', r);
  }
  state.categories = await db.getAll('categories');
  state.merchantRules = await db.getAll('merchant_rules');
  state.currentMonth = today().slice(0, 7);
}

// ─── Demo Data ────────────────────────────────────────────────────────────────
async function loadDemoData() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const demo = [
    { amount: 450, category: 'food', merchant: 'Swiggy', note: 'Dinner', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-05` },
    { amount: 1200, category: 'groceries', merchant: 'BigBasket', note: '', method: 'Card', date: `${y}-${String(mo+1).padStart(2,'0')}-07` },
    { amount: 250, category: 'transport', merchant: 'Uber', note: 'Office cab', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-08` },
    { amount: 3500, category: 'shopping', merchant: 'Amazon', note: 'Books', method: 'Card', date: `${y}-${String(mo+1).padStart(2,'0')}-10` },
    { amount: 899, category: 'entertainment', merchant: 'Netflix', note: '', method: 'Card', date: `${y}-${String(mo+1).padStart(2,'0')}-12` },
    { amount: 150, category: 'food', merchant: 'Zomato', note: 'Lunch', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-14` },
    { amount: 12000, category: 'rent', merchant: 'Landlord', note: '', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-01` },
    { amount: 500, category: 'health', merchant: 'Apollo Pharmacy', note: '', method: 'Cash', date: `${y}-${String(mo+1).padStart(2,'0')}-15` },
    { amount: 350, category: 'transport', merchant: 'Rapido', note: '', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-17` },
    { amount: 2000, category: 'education', merchant: 'Udemy', note: 'Course', method: 'Card', date: `${y}-${String(mo+1).padStart(2,'0')}-18` },
    { amount: 800, category: 'food', merchant: 'Restaurant', note: 'Dinner with family', method: 'Card', date: `${y}-${String(mo+1).padStart(2,'0')}-20` },
    { amount: 599, category: 'bills', merchant: 'Jio', note: 'Recharge', method: 'UPI', date: `${y}-${String(mo+1).padStart(2,'0')}-22` },
    // Previous month
    { amount: 400, category: 'food', merchant: 'Swiggy', note: '', method: 'UPI', date: `${y}-${String(mo).padStart(2,'0')}-15` },
    { amount: 1100, category: 'groceries', merchant: 'DMart', note: '', method: 'Cash', date: `${y}-${String(mo).padStart(2,'0')}-10` },
    { amount: 12000, category: 'rent', merchant: 'Landlord', note: '', method: 'UPI', date: `${y}-${String(mo).padStart(2,'0')}-01` },
    { amount: 300, category: 'transport', merchant: 'Ola', note: '', method: 'UPI', date: `${y}-${String(mo).padStart(2,'0')}-20` },
  ].filter(e => {
    const [, emo] = e.date.split('-').map(Number);
    return emo >= 1 && emo <= 12;
  });

  for (const e of demo) {
    e.month = dateToMonth(e.date);
    e.createdAt = Date.now();
    await db.add('expenses', e);
  }

  // Sample budgets
  const budgets = [
    { id: `food-${state.currentMonth}`, categoryId: 'food', month: state.currentMonth, amount: 2000 },
    { id: `groceries-${state.currentMonth}`, categoryId: 'groceries', month: state.currentMonth, amount: 3000 },
    { id: `transport-${state.currentMonth}`, categoryId: 'transport', month: state.currentMonth, amount: 1500 },
    { id: `entertainment-${state.currentMonth}`, categoryId: 'entertainment', month: state.currentMonth, amount: 1000 },
  ];
  for (const b of budgets) await db.put('budgets', b);

  await db.setSetting('demo_loaded', true);
  showToast('Demo data loaded!');
  renderView();
}

async function clearDemoData() {
  // Only delete the known demo merchant names, not all user data
  const DEMO_MERCHANTS = ['Swiggy','BigBasket','Uber','Amazon','Netflix','Zomato',
    'Landlord','Apollo Pharmacy','Rapido','Udemy','Restaurant','Jio','DMart','Ola'];
  const all = await db.getAll('expenses');
  const demoIds = all
    .filter(e => DEMO_MERCHANTS.includes(e.merchant))
    .map(e => e.id);
  for (const id of demoIds) await db.delete('expenses', id);

  // Clear sample budgets
  const budgets = await db.getAll('budgets');
  const demoBudgets = budgets.filter(b =>
    ['food','groceries','transport','entertainment'].includes(b.categoryId)
  );
  for (const b of demoBudgets) await db.delete('budgets', b.id);

  await db.setSetting('demo_loaded', false);
  showToast(`Removed ${demoIds.length} demo entries`);
  renderView();
}

// ─── URL Parameter Auto-Add ───────────────────────────────────────────────────
async function handleURLParams() {
  const p = new URLSearchParams(location.search);
  if (!p.get('add')) return;

  const amount = parseAmount(p.get('amount') || '0');
  if (!amount) return;

  const merchant = decodeURIComponent(p.get('merchant') || '');
  const method = p.get('method') || 'UPI';
  const { categoryId, confident } = await autoCategory(merchant);

  const expense = {
    amount,
    category: categoryId,
    merchant,
    note: p.get('note') || '',
    method,
    date: today(),
    month: today().slice(0, 7),
    createdAt: Date.now(),
  };

  const newId = await db.add('expenses', expense);
  expense.id = newId;

  if (!confident && merchant) {
    // Record as a pending merchant sighting with uncertain category
    await recordPendingMerchant(merchant, categoryId === 'other' ? null : categoryId);
    showToast(`Saved ${fmt(amount)} — tap to categorise 💕`);
    // Show clarification prompt after a brief delay so toast is visible first
    setTimeout(() => showCategoryPrompt(expense), 600);
  } else {
    showToast(`Saved ${fmt(amount)} (${getCat(categoryId).emoji} ${getCat(categoryId).name})`);
  }

  // Clean URL
  history.replaceState({}, '', location.pathname);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setView(v) {
  state.view = v;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === v);
  });
  renderView();
}

async function renderView() {
  const main = document.getElementById('main-content');
  state.categories = await db.getAll('categories');
  switch (state.view) {
    case 'dashboard':    main.innerHTML = await renderDashboard(); mountDashboard(); break;
    case 'add':          main.innerHTML = renderAddForm(); mountAddForm(); break;
    case 'transactions': main.innerHTML = await renderTransactions(); mountTransactions(); break;
    case 'budgets':      main.innerHTML = await renderBudgets(); mountBudgets(); break;
    case 'settings':     main.innerHTML = await renderSettings(); mountSettings(); break;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const month = state.currentMonth;
  const [y, m] = month.split('-').map(Number);
  const prevMonth = m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;

  const expenses = await db.getByIndex('expenses', 'month', month);
  const prevExpenses = await db.getByIndex('expenses', 'month', prevMonth);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const prevTotal = prevExpenses.reduce((s, e) => s + e.amount, 0);
  const diff = total - prevTotal;
  const diffPct = prevTotal > 0 ? ((diff / prevTotal) * 100).toFixed(0) : '';

  // Total planned budget for this month
  const allBudgets = await db.getAll('budgets');
  const monthBudgets = allBudgets.filter(b => b.month === month);
  const totalBudget = monthBudgets.reduce((s, b) => s + b.amount, 0);

  // Category breakdown
  const byCat = {};
  for (const e of expenses) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }

  // Daily spending
  const days = daysInMonth(month);
  const byDay = Array(days).fill(0);
  for (const e of expenses) {
    const d = parseInt(e.date.slice(8, 10), 10) - 1;
    if (d >= 0 && d < days) byDay[d] += e.amount;
  }

  // 6-month trend
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    let mm = m - i;
    let yy = y;
    while (mm <= 0) { mm += 12; yy--; }
    const ym = `${yy}-${String(mm).padStart(2, '0')}`;
    const exps = await db.getByIndex('expenses', 'month', ym);
    const sum = exps.reduce((s, e) => s + e.amount, 0);
    trend.push({ ym, sum, label: new Date(yy, mm - 1, 1).toLocaleString('default', { month: 'short' }) });
  }

  const diffLabel = prevTotal > 0
    ? `<span class="diff ${diff <= 0 ? 'green' : 'red'}">${diff <= 0 ? '▼' : '▲'} ${Math.abs(diffPct)}% vs last month</span>`
    : '';
  const countLabel = `<span class="expense-count">${expenses.length} expense${expenses.length !== 1 ? 's' : ''}</span>`;

  const catRows = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amt]) => {
      const cat = getCat(id);
      const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : '0';
      return `<div class="cat-row" data-cat="${id}">
        <span class="cat-emoji">${cat.emoji}</span>
        <span class="cat-name">${cat.name}</span>
        <span class="cat-pct">${pct}%</span>
        <span class="cat-amt">${fmt(amt)}</span>
      </div>`;
    }).join('');

  const pictureTiles = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amt], i) => {
      const cat = getCat(id);
      const maxAmt = Math.max(...Object.values(byCat));
      const scale = 0.6 + (amt / maxAmt) * 0.4;
      return `<div class="pic-tile" data-cat="${id}" style="--scale:${scale.toFixed(2)}">
        <div class="pic-emoji">${cat.emoji}</div>
        <div class="pic-name">${cat.name}</div>
        <div class="pic-amt">${fmt(amt)}</div>
      </div>`;
    }).join('');

  let storageBannerMsg = null;
  if (isRunningInSafariInsteadOfPWA()) {
    storageBannerMsg = `<strong>You're in Safari, not the installed app.</strong>
      Expenses you add here won't appear in your Home Screen app — they use separate storage. Open from your Home Screen icon instead.`;
  } else if (state.storagePersisted === false) {
    storageBannerMsg = `<strong>Your data may be deleted by the browser.</strong>
      Add this app to your Home Screen to protect your expenses.`;
  }
  const storageBanner = storageBannerMsg ? `
  <div class="storage-banner" id="storage-banner">
    <span class="storage-banner-icon">⚠️</span>
    <div class="storage-banner-text">${storageBannerMsg}</div>
    <button class="storage-banner-dismiss" id="dismiss-storage-banner" aria-label="Dismiss">✕</button>
  </div>` : '';

  return `
<div class="view-dashboard">
  ${storageBanner}
  <div class="dash-header">
    <button class="month-nav" id="prev-month">‹</button>
    <h2 class="month-label">${monthLabel(month)}</h2>
    <button class="month-nav" id="next-month">›</button>
  </div>

  <div class="total-card card">
    <div class="total-label">Total Spent</div>
    <div class="total-amount">${fmt(total)}</div>
    ${countLabel}
    ${diffLabel}
    ${totalBudget > 0 ? `
    <div class="budget-bar-wrap">
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${total > totalBudget ? 'over' : total / totalBudget > 0.8 ? 'warn' : ''}"
          style="width:${Math.min((total / totalBudget) * 100, 100).toFixed(1)}%"></div>
      </div>
      <div class="budget-bar-labels">
        <span class="budget-bar-spent">${fmt(total)} of ${fmt(totalBudget)} budget</span>
        <span class="budget-bar-left ${total > totalBudget ? 'red' : 'green'}">
          ${total > totalBudget ? `${fmt(total - totalBudget)} over` : `${fmt(totalBudget - total)} left`}
        </span>
      </div>
    </div>` : ''}
  </div>

  <div class="card chart-card">
    <div class="chart-header">
      <span class="chart-title">Where it went</span>
      <div class="toggle-btns">
        <button class="toggle-btn ${!state.pictureMode ? 'active' : ''}" id="btn-pie">🥧 Chart</button>
        <button class="toggle-btn ${state.pictureMode ? 'active' : ''}" id="btn-picture">🖼️ Picture</button>
      </div>
    </div>
    <div id="pie-view" class="${state.pictureMode ? 'hidden' : ''}">
      ${total > 0
        ? `<div class="chart-wrap"><canvas id="pieChart"></canvas></div>
           <div class="cat-list">${catRows}</div>`
        : '<div class="empty-state">No expenses this month</div>'
      }
    </div>
    <div id="picture-view" class="${state.pictureMode ? '' : 'hidden'}">
      ${total > 0
        ? `<div class="picture-grid">${pictureTiles}</div>`
        : '<div class="empty-state">No expenses this month</div>'
      }
    </div>
  </div>

  <div class="card chart-card">
    <div class="chart-title">Daily spending</div>
    <div class="chart-wrap-bar"><canvas id="barChart"></canvas></div>
  </div>

  <div class="card chart-card">
    <div class="chart-title">Budget vs Actual</div>
    <div class="chart-wrap-bar" id="budget-chart-wrap"><canvas id="budgetChart"></canvas></div>
  </div>
</div>

<!-- Category detail modal -->
<div class="modal" id="cat-modal">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div id="cat-modal-content"></div>
  </div>
</div>
`;
}

async function mountDashboard() {
  const month = state.currentMonth;
  const expenses = await db.getByIndex('expenses', 'month', month);
  const [y, m] = month.split('-').map(Number);

  document.getElementById('dismiss-storage-banner')?.addEventListener('click', () => {
    document.getElementById('storage-banner')?.remove();
    state.storagePersisted = true; // suppress for this session
  });

  document.getElementById('prev-month')?.addEventListener('click', () => {
    let nm = m - 1, ny = y;
    if (nm < 1) { nm = 12; ny--; }
    state.currentMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    renderView();
  });

  document.getElementById('next-month')?.addEventListener('click', () => {
    let nm = m + 1, ny = y;
    if (nm > 12) { nm = 1; ny++; }
    state.currentMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    renderView();
  });

  document.getElementById('btn-pie')?.addEventListener('click', () => {
    state.pictureMode = false;
    document.getElementById('pie-view').classList.remove('hidden');
    document.getElementById('picture-view').classList.add('hidden');
    document.getElementById('btn-pie').classList.add('active');
    document.getElementById('btn-picture').classList.remove('active');
    renderPieChart(expenses);
  });

  document.getElementById('btn-picture')?.addEventListener('click', () => {
    state.pictureMode = true;
    document.getElementById('pie-view').classList.add('hidden');
    document.getElementById('picture-view').classList.remove('hidden');
    document.getElementById('btn-pie').classList.remove('active');
    document.getElementById('btn-picture').classList.add('active');
  });

  // Category row tap -> show expenses
  document.querySelectorAll('.cat-row, .pic-tile').forEach(el => {
    el.addEventListener('click', async () => {
      const catId = el.dataset.cat;
      const cat = getCat(catId);
      const catExps = expenses.filter(e => e.category === catId).sort((a,b) => b.date.localeCompare(a.date));
      const total = catExps.reduce((s, e) => s + e.amount, 0);
      document.getElementById('cat-modal-content').innerHTML = `
        <div class="modal-title">${cat.emoji} ${cat.name} — ${fmt(total)}</div>
        <div class="exp-list">
          ${catExps.length === 0 ? '<div class="empty-state">No expenses</div>' :
            catExps.map(e => `
              <div class="exp-row">
                <div class="exp-row-left">
                  <div class="exp-merchant">${e.merchant || cat.name}</div>
                  <div class="exp-meta">${e.date}${e.note ? ' · ' + e.note : ''} · ${e.method}</div>
                </div>
                <div class="exp-amount">${fmt(e.amount)}</div>
              </div>
            `).join('')
          }
        </div>
      `;
      openModal('cat-modal');
    });
  });

  document.getElementById('cat-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('cat-modal');
  });

  // Charts
  if (!state.pictureMode && expenses.length > 0) renderPieChart(expenses);
  renderBarChart(expenses, month);
  await renderBudgetVsActualChart(month);
}

function renderPieChart(expenses) {
  const ctx = document.getElementById('pieChart');
  if (!ctx) return;
  if (state.chart) { state.chart.destroy(); state.chart = null; }

  const byCat = {};
  for (const e of expenses) byCat[e.category] = (byCat[e.category] || 0) + e.amount;

  const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([id]) => getCat(id).name);
  const data = sorted.map(([, v]) => v);
  const colors = sorted.map(([id]) => getCat(id).color);

  state.chart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent', hoverOffset: 8 }] },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '62%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${fmt(ctx.raw)} (${((ctx.raw / ctx.dataset.data.reduce((a,b)=>a+b,0))*100).toFixed(1)}%)`
          }
        }
      }
    }
  });
}

function renderBarChart(expenses, month) {
  const ctx = document.getElementById('barChart');
  if (!ctx) return;
  if (state.barChart) { state.barChart.destroy(); state.barChart = null; }

  const days = daysInMonth(month);
  const byDay = Array(days).fill(0);
  for (const e of expenses) {
    const d = parseInt(e.date.slice(8, 10), 10) - 1;
    if (d >= 0 && d < days) byDay[d] += e.amount;
  }

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const textColor = isDark ? '#8d8d93' : '#8e8e93';

  state.barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: byDay.map((_, i) => i + 1),
      datasets: [{
        data: byDay,
        backgroundColor: '#f472b6cc',
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${fmt(ctx.raw)}` }
      }},
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v) } }
      }
    }
  });
}

async function renderBudgetVsActualChart(month) {
  const wrap = document.getElementById('budget-chart-wrap');
  const ctx = document.getElementById('budgetChart');
  if (!ctx) return;
  if (state.trendChart) { state.trendChart.destroy(); state.trendChart = null; }

  const allBudgets = await db.getAll('budgets');
  const monthBudgets = allBudgets.filter(b => b.month === month);
  const expenses = await db.getByIndex('expenses', 'month', month);

  if (monthBudgets.length === 0) {
    if (wrap) wrap.innerHTML = '<div class="empty-state" style="padding:24px 0">No budgets set — add budgets to see this chart</div>';
    return;
  }

  const spentByCat = {};
  for (const e of expenses) spentByCat[e.category] = (spentByCat[e.category] || 0) + e.amount;

  const labels = monthBudgets.map(b => getCat(b.categoryId).name);
  const budgetData = monthBudgets.map(b => b.amount);
  const spentData  = monthBudgets.map(b => spentByCat[b.categoryId] || 0);
  const leftData   = monthBudgets.map(b => Math.max(0, b.amount - (spentByCat[b.categoryId] || 0)));

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  const textColor = isDark ? '#8d8d93' : '#8e8e93';

  state.trendChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Budget',    data: budgetData, backgroundColor: 'rgba(96,165,250,0.75)',  borderRadius: 4 },
        { label: 'Spent',     data: spentData,  backgroundColor: 'rgba(248,113,113,0.75)', borderRadius: 4 },
        { label: 'Remaining', data: leftData,   backgroundColor: 'rgba(52,211,153,0.75)',  borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: textColor, boxWidth: 12, padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxRotation: 30 } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v) }, beginAtZero: true }
      }
    }
  });
}

// ─── Add Expense Form ─────────────────────────────────────────────────────────
function renderAddForm(editData = null) {
  const e = editData || state.editingExpense || {};
  const isEdit = !!e.id;
  const methods = ['UPI', 'Card', 'Cash'];

  const catGrid = state.categories.map(cat => `
    <div class="cat-pick ${(e.category || 'food') === cat.id ? 'selected' : ''}" data-id="${cat.id}">
      <div class="cat-pick-emoji">${cat.emoji}</div>
      <div class="cat-pick-name">${cat.name}</div>
    </div>
  `).join('');

  const methodBtns = methods.map(mt => `
    <button type="button" class="method-btn ${(e.method || 'UPI') === mt ? 'active' : ''}" data-method="${mt}">${mt}</button>
  `).join('');

  return `
<div class="view-add">
  <div class="add-header">
    <h2>${isEdit ? 'Edit Expense' : 'Add Expense'}</h2>
    ${isEdit ? '<button class="btn-link danger" id="delete-expense">Delete</button>' : ''}
  </div>

  <form id="add-form" autocomplete="off">
    <div class="amount-input-wrap">
      <span class="currency-sym">₹</span>
      <input type="number" id="f-amount" inputmode="decimal" placeholder="0" value="${e.amount || ''}" required step="0.01" min="0.01" class="amount-input">
    </div>

    <label class="field-label">Category</label>
    <div class="cat-grid" id="cat-grid">${catGrid}</div>

    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Date</label>
        <input type="date" id="f-date" value="${e.date || today()}" class="field-input" required>
      </div>
      <div class="form-group">
        <label class="field-label">Payment</label>
        <div class="method-group">${methodBtns}</div>
      </div>
    </div>

    <label class="field-label">Merchant / Shop</label>
    <input type="text" id="f-merchant" placeholder="e.g. Swiggy, DMart" value="${e.merchant || ''}" class="field-input">

    <label class="field-label">Note (optional)</label>
    <input type="text" id="f-note" placeholder="What was this for?" value="${e.note || ''}" class="field-input">

    <button type="submit" class="btn-primary">${isEdit ? 'Save Changes' : '+ Add Expense'}</button>
    ${isEdit ? '<button type="button" class="btn-secondary" id="cancel-edit">Cancel</button>' : ''}
  </form>

  <div class="sms-section card">
    <div class="sms-header">
      <span>📱 Paste SMS to auto-fill</span>
      <button class="btn-link" id="sms-toggle">Expand</button>
    </div>
    <div id="sms-body" class="hidden">
      <textarea id="sms-input" placeholder="Paste bank/UPI SMS here..." rows="4" class="field-input sms-textarea"></textarea>
      <button type="button" class="btn-secondary" id="parse-sms">Parse SMS</button>
    </div>
  </div>
</div>
`;
}

function mountAddForm() {
  let selectedCat = state.editingExpense?.category || 'food';
  let selectedMethod = state.editingExpense?.method || 'UPI';

  // Category picker
  document.querySelectorAll('.cat-pick').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.cat-pick').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedCat = el.dataset.id;
    });
  });

  // Method picker
  document.querySelectorAll('.method-btn').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.method-btn').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      selectedMethod = el.dataset.method;
    });
  });

  // SMS toggle
  document.getElementById('sms-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('sms-body');
    const btn = document.getElementById('sms-toggle');
    body.classList.toggle('hidden');
    btn.textContent = body.classList.contains('hidden') ? 'Expand' : 'Collapse';
  });

  // SMS parser
  document.getElementById('parse-sms')?.addEventListener('click', async () => {
    const text = document.getElementById('sms-input').value.trim();
    if (!text) return showToast('Paste an SMS first', 'error');
    const result = parseSMS(text);
    if (!result) return showToast('Could not parse amount from SMS', 'error');
    document.getElementById('f-amount').value = result.amount;
    if (result.merchant) document.getElementById('f-merchant').value = result.merchant;
    // Auto-category
    if (result.merchant) {
      const { categoryId: catId } = await autoCategory(result.merchant);
      selectedCat = catId;
      document.querySelectorAll('.cat-pick').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === catId);
      });
    }
    document.getElementById('sms-body').classList.add('hidden');
    document.getElementById('sms-toggle').textContent = 'Expand';
    showToast(`Parsed: ${fmt(result.amount)}${result.merchant ? ' from ' + result.merchant : ''}`);
  });

  // Delete
  document.getElementById('delete-expense')?.addEventListener('click', async () => {
    if (!state.editingExpense?.id) return;
    if (confirm('Delete this expense?')) {
      await db.delete('expenses', state.editingExpense.id);
      gistSync();
      state.editingExpense = null;
      showToast('Deleted', 'success');
      setView('transactions');
    }
  });

  document.getElementById('cancel-edit')?.addEventListener('click', () => {
    state.editingExpense = null;
    setView('transactions');
  });

  // Form submit
  document.getElementById('add-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseAmount(document.getElementById('f-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

    const merchant = document.getElementById('f-merchant').value.trim();
    const date = document.getElementById('f-date').value;

    const expense = {
      amount,
      category: selectedCat,
      date,
      month: dateToMonth(date),
      note: document.getElementById('f-note').value.trim(),
      method: selectedMethod,
      merchant,
      createdAt: Date.now(),
    };

    if (state.editingExpense?.id) {
      expense.id = state.editingExpense.id;
      await db.put('expenses', expense);
      if (merchant) await learnMerchant(merchant, selectedCat);
      gistSync();
      state.editingExpense = null;
      showToast('Updated!');
      setView('transactions');
    } else {
      await db.add('expenses', expense);
      if (merchant) await learnMerchant(merchant, selectedCat);
      gistSync();
      showToast('Expense added!');
      // Reset form
      document.getElementById('f-amount').value = '';
      document.getElementById('f-merchant').value = '';
      document.getElementById('f-note').value = '';
      document.getElementById('f-date').value = today();
      selectedCat = 'food';
      selectedMethod = 'UPI';
      document.querySelectorAll('.cat-pick').forEach(el => el.classList.toggle('selected', el.dataset.id === 'food'));
      document.querySelectorAll('.method-btn').forEach(el => el.classList.toggle('active', el.dataset.method === 'UPI'));
      document.getElementById('f-amount').focus();
    }
  });

  // Auto-focus amount
  setTimeout(() => document.getElementById('f-amount')?.focus(), 100);
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function renderTransactions() {
  let expenses = await db.getAll('expenses');

  // Apply filters
  if (state.filterCategory) expenses = expenses.filter(e => e.category === state.filterCategory);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    expenses = expenses.filter(e =>
      (e.merchant || '').toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      String(e.amount).includes(q)
    );
  }

  expenses.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  // Group by date
  const groups = {};
  for (const e of expenses) {
    (groups[e.date] = groups[e.date] || []).push(e);
  }

  const catOptions = state.categories.map(c =>
    `<option value="${c.id}" ${state.filterCategory === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`
  ).join('');

  const groupsHTML = Object.entries(groups).length === 0
    ? '<div class="empty-state">No expenses found</div>'
    : Object.entries(groups).map(([date, exps]) => {
        const dayTotal = exps.reduce((s, e) => s + e.amount, 0);
        const d = new Date(date + 'T00:00:00');
        const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        return `
          <div class="day-group">
            <div class="day-header">
              <span class="day-label">${label}</span>
              <span class="day-total">${fmt(dayTotal)}</span>
            </div>
            ${exps.map(e => {
              const cat = getCat(e.category);
              return `
                <div class="exp-item" data-id="${e.id}">
                  <div class="exp-icon" style="background:${cat.color}22;color:${cat.color}">${cat.emoji}</div>
                  <div class="exp-info">
                    <div class="exp-title">${e.merchant || cat.name}</div>
                    <div class="exp-sub">${cat.name}${e.note ? ' · ' + e.note : ''} · ${e.method}</div>
                  </div>
                  <div class="exp-right">
                    <div class="exp-amt">${fmt(e.amount)}</div>
                    <button class="delete-btn" data-id="${e.id}">🗑</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      }).join('');

  return `
<div class="view-transactions">
  <h2 class="view-title">Transactions</h2>
  <div class="filter-bar">
    <input type="search" id="search-input" placeholder="🔍 Search..." value="${state.searchQuery}" class="search-input">
    <select id="cat-filter" class="cat-filter-select">
      <option value="">All categories</option>
      ${catOptions}
    </select>
  </div>
  <div id="exp-list">${groupsHTML}</div>
</div>
`;
}

function mountTransactions() {
  document.getElementById('search-input')?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    renderTransactions().then(html => {
      document.getElementById('exp-list').innerHTML =
        html.match(/<div id="exp-list">([\s\S]*?)<\/div>\s*$/)?.[1] || '';
    });
    // Re-render just the list part
    renderView();
  });

  document.getElementById('cat-filter')?.addEventListener('change', e => {
    state.filterCategory = e.target.value || null;
    renderView();
  });

  // Tap to edit
  document.querySelectorAll('.exp-item').forEach(el => {
    el.addEventListener('click', async e => {
      if (e.target.classList.contains('delete-btn')) return;
      const id = parseInt(el.dataset.id);
      const expense = await db.get('expenses', id);
      if (expense) {
        state.editingExpense = expense;
        setView('add');
      }
    });
  });

  // Delete button
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      if (confirm('Delete this expense?')) {
        await db.delete('expenses', id);
        gistSync();
        showToast('Deleted');
        renderView();
      }
    });
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────
async function renderBudgets() {
  const month = state.currentMonth;
  const budgets = await db.getAll('budgets');
  const monthBudgets = budgets.filter(b => b.month === month);
  const expenses = await db.getByIndex('expenses', 'month', month);

  const spentByCat = {};
  for (const e of expenses) spentByCat[e.category] = (spentByCat[e.category] || 0) + e.amount;

  const totalBudget = monthBudgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
  const totalRemaining = totalBudget - totalSpent;
  const totalPct = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const overallStatus = totalPct >= 100 ? 'over' : totalPct >= 80 ? 'warn' : 'ok';

  const totalSummary = `
  <div class="budget-total-card card">
    <div class="budget-total-row">
      <div class="budget-total-col">
        <div class="budget-total-label">Total Budget</div>
        <div class="budget-total-val">${fmt(totalBudget)}</div>
      </div>
      <div class="budget-total-divider"></div>
      <div class="budget-total-col">
        <div class="budget-total-label">Total Spent</div>
        <div class="budget-total-val">${fmt(totalSpent)}</div>
      </div>
      <div class="budget-total-divider"></div>
      <div class="budget-total-col">
        <div class="budget-total-label">${totalRemaining < 0 ? 'Over by' : 'Remaining'}</div>
        <div class="budget-total-val ${totalRemaining < 0 ? 'red' : totalBudget > 0 ? 'green' : ''}">${fmt(Math.abs(totalRemaining))}</div>
      </div>
    </div>
    ${totalBudget > 0 ? `
    <div class="progress-bar-wrap" style="margin-top:10px">
      <div class="progress-bar ${overallStatus}" style="width:${totalPct.toFixed(1)}%"></div>
    </div>
    <div style="text-align:center;margin-top:4px;font-size:12px;color:var(--text3)">${totalPct.toFixed(0)}% of budget used</div>
    ` : '<div style="text-align:center;margin-top:8px;font-size:12px;color:var(--text3)">No budgets set for this month</div>'}
  </div>`;

  const budgetRows = monthBudgets.length === 0
    ? '<div class="empty-state">No budgets set for this month.<br>Tap + to add one.</div>'
    : monthBudgets.map(b => {
        const cat = getCat(b.categoryId);
        const spent = spentByCat[b.categoryId] || 0;
        const pct = Math.min((spent / b.amount) * 100, 100);
        const status = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
        return `
          <div class="budget-item card" data-id="${b.id}">
            <div class="budget-top">
              <span class="budget-cat">${cat.emoji} ${cat.name}</span>
              <span class="budget-amounts ${status}">${fmt(spent)} / ${fmt(b.amount)}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar ${status}" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <div class="budget-bottom">
              <span class="budget-left ${status}">
                ${pct >= 100 ? `Over by ${fmt(spent - b.amount)}` : `${fmt(b.amount - spent)} left`}
              </span>
              <button class="btn-link" data-budget-edit="${b.id}">Edit</button>
            </div>
          </div>
        `;
      }).join('');

  const catOptionsForModal = state.categories.map(c =>
    `<option value="${c.id}">${c.emoji} ${c.name}</option>`
  ).join('');

  return `
<div class="view-budgets">
  <div class="view-header">
    <h2 class="view-title">Budgets — ${monthLabel(month)}</h2>
    <button class="btn-icon" id="add-budget">＋</button>
  </div>
  ${totalSummary}
  <div id="budget-list">${budgetRows}</div>
</div>

<div class="modal" id="budget-modal">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title" id="budget-modal-title">Set Budget</div>
    <form id="budget-form">
      <input type="hidden" id="b-id">
      <label class="field-label">Category</label>
      <select id="b-cat" class="field-input">${catOptionsForModal}</select>
      <label class="field-label">Monthly Budget (₹)</label>
      <input type="number" id="b-amount" inputmode="decimal" placeholder="0" class="field-input" required min="1" step="1">
      <button type="submit" class="btn-primary">Save Budget</button>
      <button type="button" class="btn-secondary" id="cancel-budget">Cancel</button>
      <button type="button" class="btn-secondary danger" id="delete-budget" style="display:none">Delete Budget</button>
    </form>
  </div>
</div>
`;
}

function mountBudgets() {
  document.getElementById('add-budget')?.addEventListener('click', () => {
    document.getElementById('b-id').value = '';
    document.getElementById('b-amount').value = '';
    document.getElementById('budget-modal-title').textContent = 'Set Budget';
    document.getElementById('delete-budget').style.display = 'none';
    openModal('budget-modal');
  });

  document.querySelectorAll('[data-budget-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const bid = btn.dataset.budgetEdit;
      const budget = await db.get('budgets', bid);
      if (!budget) return;
      document.getElementById('b-id').value = budget.id;
      document.getElementById('b-cat').value = budget.categoryId;
      document.getElementById('b-amount').value = budget.amount;
      document.getElementById('budget-modal-title').textContent = 'Edit Budget';
      document.getElementById('delete-budget').style.display = '';
      openModal('budget-modal');
    });
  });

  document.getElementById('delete-budget')?.addEventListener('click', async () => {
    const bid = document.getElementById('b-id').value;
    if (!bid) return;
    await db.delete('budgets', bid);
    closeModal('budget-modal');
    showToast('Budget deleted');
    gistSync();
    renderView();
  });

  document.getElementById('cancel-budget')?.addEventListener('click', () => closeModal('budget-modal'));
  document.getElementById('budget-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('budget-modal');
  });

  document.getElementById('budget-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const catId = document.getElementById('b-cat').value;
    const amount = parseAmount(document.getElementById('b-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
    const id = `${catId}-${state.currentMonth}`;
    await db.put('budgets', { id, categoryId: catId, month: state.currentMonth, amount });
    closeModal('budget-modal');
    showToast('Budget saved!');
    renderView();
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function renderSettings() {
  const demoLoaded = await db.getSetting('demo_loaded', false);
  const githubToken = await db.getSetting('github_token', '');
  const gistId = await db.getSetting('github_gist_id', '');
  const lastGistSync = await db.getSetting('last_gist_sync', '');
  const catRows = state.categories.map(c => `
    <div class="setting-row cat-row-edit" data-id="${c.id}">
      <span class="cat-emoji-lg">${c.emoji}</span>
      <input type="text" class="cat-name-input field-input-sm" data-id="${c.id}" value="${c.name}">
      <input type="text" class="cat-emoji-input field-input-sm" data-id="${c.id}" value="${c.emoji}" maxlength="2" style="width:48px;text-align:center">
      <button class="btn-link danger cat-delete" data-id="${c.id}">✕</button>
    </div>
  `).join('');

  const rules = await db.getAll('merchant_rules');
  const ruleRows = rules.map(r => `
    <div class="rule-row" data-id="${r.id}">
      <input type="text" class="field-input-sm rule-kw" value="${r.keyword}" data-id="${r.id}">
      <span>→</span>
      <select class="field-input-sm rule-cat" data-id="${r.id}">
        ${state.categories.map(c => `<option value="${c.id}" ${r.categoryId === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('')}
      </select>
      <button class="btn-link danger rule-delete" data-id="${r.id}">✕</button>
    </div>
  `).join('');

  return `
<div class="view-settings">
  <h2 class="view-title">Settings</h2>

  <!-- Demo data -->
  <div class="settings-section card">
    <div class="settings-section-title">🎭 Demo Data</div>
    <div class="setting-row">
      <span>Sample data for preview</span>
      <div class="btn-group">
        ${demoLoaded
          ? '<button class="btn-secondary-sm" id="clear-demo">Clear Demo</button>'
          : '<button class="btn-secondary-sm" id="load-demo">Load Demo</button>'}
      </div>
    </div>
  </div>

  <!-- GitHub Gist Sync -->
  <div class="settings-section card">
    <div class="settings-section-title">☁️ Sync (Safari ↔ Home Screen)</div>
    <p class="hint-text" style="margin-bottom:10px">Keeps your expenses in sync between Safari and the installed app. Every expense you add is saved to a private GitHub Gist automatically.</p>
    <label class="field-label">GitHub Token <span style="font-weight:400;color:var(--text3)">(gist scope)</span></label>
    <input type="password" id="github-token-input" class="field-input" placeholder="ghp_xxxxxxxxxxxx"
      value="${githubToken}" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
    <p class="hint-text" style="margin-top:6px">
      <a href="https://github.com/settings/tokens/new?scopes=gist&description=Expense+Tracker+Sync" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">👉 Create a token here</a> — tick <strong>gist</strong> → Generate → copy &amp; paste above
    </p>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn-primary" id="save-gist-token" style="flex:1">${githubToken ? 'Update &amp; Sync' : 'Save &amp; Sync Now'}</button>
      ${gistId ? `<button class="btn-secondary" id="gist-pull-now" style="flex:1">↓ Pull Latest</button>` : ''}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
      <span id="gist-sync-status" class="hint-text" style="font-size:12px">${
        lastGistSync ? `☁️ Last sync: ${lastGistSync}` :
        gistId ? '✅ Configured — auto-syncs on every expense' :
        'Not set up yet'
      }</span>
      ${gistId ? `<button class="btn-link danger" id="gist-disconnect" style="font-size:12px">Disconnect</button>` : ''}
    </div>
  </div>

  <!-- Export/Import -->
  <div class="settings-section card">
    <div class="settings-section-title">📂 Export / Import</div>
    <div class="setting-row" style="margin-bottom:8px">
      <span style="font-size:13px;color:var(--text-secondary)" id="last-backup-label">${
        (await db.getSetting('last_backup'))
          ? `Last backup: ${await db.getSetting('last_backup')}`
          : 'No backup yet — back up regularly to protect against iOS data loss'
      }</span>
    </div>
    <div class="setting-row-stack">
      <button class="btn-secondary" id="export-csv">Export CSV</button>
      <button class="btn-primary" id="export-json">Backup JSON</button>
      <button class="btn-secondary" id="import-json">Restore from backup</button>
      <input type="file" id="import-file" accept=".json" class="hidden">
    </div>
  </div>

  <!-- Categories -->
  <div class="settings-section card">
    <div class="settings-section-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>🏷️ Categories</span>
      <button class="btn-add-cat" id="add-cat-btn">＋ New</button>
    </div>
    <div id="cat-list-edit">${catRows}</div>
    <button class="btn-secondary" id="save-cats" style="margin-top:4px">Save Changes</button>
  </div>

  <!-- Add / Edit Category Modal -->
  <div class="modal" id="new-cat-modal">
    <div class="modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-title">✨ New Category</div>

      <label class="field-label">Name</label>
      <input type="text" id="nc-name" placeholder="e.g. Coffee, Petrol, Gifts…" class="field-input" autocomplete="off">

      <label class="field-label">Emoji — tap one or type your own</label>
      <div class="emoji-presets">
        ${['☕','🧃','🍕','🍜','🥗','🛵','⛽','🏥','💇','🐾','👗','💄','🎁','🎉','🏋️','📖','🎸','✈️','🏠','💡','🧹','🐶','🌸','💅','🍰','🎀','🛍️','🪴','🏖️','🎬'].map(e =>
          `<button type="button" class="emoji-preset-btn" data-emoji="${e}">${e}</button>`
        ).join('')}
      </div>
      <input type="text" id="nc-emoji" placeholder="☕" class="field-input emoji-solo" maxlength="2">

      <label class="field-label">Colour</label>
      <div class="color-swatches">
        ${['#FF6B6B','#FF8FAB','#FFB3D0','#F9A8D4','#E879F9','#A78BFA','#818CF8','#60A5FA','#34D399','#86EFAC','#FCD34D','#FB923C','#F87171','#94A3B8','#C084FC','#F472B6'].map(c =>
          `<button type="button" class="color-swatch" data-color="${c}" style="background:${c}"></button>`
        ).join('')}
      </div>
      <input type="hidden" id="nc-color" value="#F472B6">

      <button type="button" class="btn-primary" id="nc-save">Add Category</button>
      <button type="button" class="btn-secondary" id="nc-cancel">Cancel</button>
    </div>
  </div>

  <!-- Merchant Rules -->
  <div class="settings-section card">
    <div class="settings-section-title">🤖 Auto-categorize Rules</div>
    <p class="hint-text">Keywords matched against merchant names (case-insensitive)</p>
    <div id="rule-list">${ruleRows}</div>
    <button class="btn-link" id="add-rule-btn" style="margin-top:8px">+ Add Rule</button>
    <button class="btn-secondary" id="save-rules" style="margin-top:8px">Save Rules</button>
  </div>

  <!-- iOS Shortcuts / Automation -->
  <div class="settings-section card" id="automation-guide">
    <div class="settings-section-title">📱 iOS Shortcuts Automation</div>
    <div class="automation-content">
      <p>Track expenses <strong>automatically</strong> when you make a UPI/card payment, without opening this app.</p>

      <h4>Option A – SMS Trigger (most reliable)</h4>
      <p>Every time your bank sends a debit SMS, a Shortcut can open this app with the amount pre-filled.</p>
      <ol>
        <li>Open the <strong>Shortcuts</strong> app → tap <strong>Automation</strong> tab → tap <strong>+</strong></li>
        <li>Choose <strong>Personal Automation</strong> → scroll to <strong>Message</strong></li>
        <li>Set <em>Message Contains</em> to <code>debited</code> → tap Next</li>
        <li>Add action: <strong>Get variable</strong> → pick <em>Shortcut Input → Message Content</em></li>
        <li>Add action: <strong>URL</strong> → paste:<br>
          <code class="code-block">${location.origin}${location.pathname}?add=1&amp;amount=[amount]&amp;merchant=[merchant]&amp;method=UPI</code>
        </li>
        <li>Add action: <strong>Open URLs</strong></li>
        <li>Turn off <em>"Ask Before Running"</em> if you want it silent</li>
      </ol>
      <div class="note-box">⚠️ iOS may ask for a tap to confirm on first run. This is an Apple security requirement and cannot be bypassed.</div>

      <h4>Option B – URL Scheme (manual, instant)</h4>
      <p>Add a widget to your Home Screen with a button that opens the app. Works 100% reliably.</p>
      <p>Share this URL with yourself and bookmark it in Safari:</p>
      <code class="code-block">${location.origin}${location.pathname}?add=1&amp;amount=0&amp;merchant=&amp;method=UPI</code>

      <h4>URL Format Reference</h4>
      <code class="code-block">?add=1&amp;amount=250&amp;merchant=Swiggy&amp;method=UPI&amp;note=Lunch</code>
      <p>Supported methods: <code>UPI</code>, <code>Card</code>, <code>Cash</code></p>
    </div>
  </div>

  <!-- About -->
  <div class="settings-section card">
    <div class="settings-section-title">ℹ️ About</div>
    <p class="hint-text">Expense Tracker PWA · All data stored on your device · No accounts · No servers</p>
    <p class="hint-text">Version 1.0</p>
  </div>
</div>
`;
}

function mountSettings() {
  // GitHub Gist sync
  document.getElementById('save-gist-token')?.addEventListener('click', async () => {
    const token = document.getElementById('github-token-input').value.trim();
    if (!token) return showToast('Paste your GitHub token first', 'error');
    await db.setSetting('github_token', token);
    const el = document.getElementById('gist-sync-status');
    if (el) el.textContent = '⏳ Syncing…';
    await gistSync();
    // Refresh settings to show Gist ID
    setTimeout(() => renderView(), 1500);
  });

  document.getElementById('gist-pull-now')?.addEventListener('click', async () => {
    const el = document.getElementById('gist-sync-status');
    if (el) el.textContent = '⏳ Loading from GitHub…';
    await loadFromGist();
    state.categories = await db.getAll('categories');
    state.merchantRules = await db.getAll('merchant_rules');
    showToast('✅ Data loaded from GitHub!');
    renderView();
  });

  document.getElementById('gist-disconnect')?.addEventListener('click', async () => {
    if (!confirm('Disconnect GitHub sync? Your local data stays, but it will no longer sync.')) return;
    await db.setSetting('github_token', '');
    await db.setSetting('github_gist_id', '');
    await db.setSetting('last_gist_sync', '');
    showToast('Disconnected');
    renderView();
  });

  // Demo data
  document.getElementById('load-demo')?.addEventListener('click', loadDemoData);
  document.getElementById('clear-demo')?.addEventListener('click', clearDemoData);

  // Export CSV
  document.getElementById('export-csv')?.addEventListener('click', async () => {
    const expenses = await db.getAll('expenses');
    if (!expenses.length) return showToast('No expenses to export', 'error');
    const header = 'Date,Amount,Category,Merchant,Note,Method\n';
    const rows = expenses.map(e => [e.date, e.amount, getCat(e.category).name, `"${(e.merchant||'').replace(/"/g,'""')}"`, `"${(e.note||'').replace(/"/g,'""')}"`, e.method].join(','));
    const csv = header + rows.join('\n');
    downloadFile(csv, `expenses-${today()}.csv`, 'text/csv');
    showToast('CSV exported!');
  });

  // Export JSON
  document.getElementById('export-json')?.addEventListener('click', async () => {
    const expenses = await db.getAll('expenses');
    const cats = await db.getAll('categories');
    const budgets = await db.getAll('budgets');
    const payload = { version: 1, exportDate: today(), expenses, categories: cats, budgets };
    downloadFile(JSON.stringify(payload, null, 2), `expenses-${today()}.json`, 'application/json');
    await db.setSetting('last_backup', today());
    showToast('JSON exported! Save it to Files or iCloud.');
    const lbl = document.getElementById('last-backup-label');
    if (lbl) lbl.textContent = `Last backup: ${today()}`;
  });

  // Import JSON
  document.getElementById('import-json')?.addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file')?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.expenses) throw new Error('Invalid file format');
      if (!confirm(`Import ${data.expenses.length} expenses? This will add to your existing data.`)) return;
      for (const exp of data.expenses) {
        const { id, ...rest } = exp;
        await db.add('expenses', rest);
      }
      if (data.categories?.length) {
        for (const cat of data.categories) await db.put('categories', cat);
      }
      if (data.budgets?.length) {
        for (const b of data.budgets) await db.put('budgets', b);
      }
      showToast(`Imported ${data.expenses.length} expenses!`);
      renderView();
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  // Save categories
  document.getElementById('save-cats')?.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.cat-name-input');
    for (const inp of inputs) {
      const id = inp.dataset.id;
      const cat = state.categories.find(c => c.id === id);
      if (!cat) continue;
      const emojiInp = document.querySelector(`.cat-emoji-input[data-id="${id}"]`);
      cat.name = inp.value.trim() || cat.name;
      cat.emoji = emojiInp?.value.trim() || cat.emoji;
      await db.put('categories', cat);
    }
    state.categories = await db.getAll('categories');
    showToast('Categories saved!');
  });

  // Delete category
  document.querySelectorAll('.cat-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm(`Delete category "${getCat(id).name}"?`)) return;
      await db.delete('categories', id);
      state.categories = await db.getAll('categories');
      renderView();
    });
  });

  // Add category — open proper modal
  document.getElementById('add-cat-btn')?.addEventListener('click', () => {
    document.getElementById('nc-name').value = '';
    document.getElementById('nc-emoji').value = '';
    document.getElementById('nc-color').value = '#F472B6';
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === '#F472B6'));
    openModal('new-cat-modal');
    setTimeout(() => document.getElementById('nc-name').focus(), 300);
  });

  // Emoji preset tap
  document.querySelectorAll('.emoji-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('nc-emoji').value = btn.dataset.emoji;
      document.querySelectorAll('.emoji-preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Colour swatch tap
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.getElementById('nc-color').value = sw.dataset.color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });

  document.getElementById('nc-cancel')?.addEventListener('click', () => closeModal('new-cat-modal'));
  document.getElementById('new-cat-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('new-cat-modal');
  });

  document.getElementById('nc-save')?.addEventListener('click', async () => {
    const name = document.getElementById('nc-name').value.trim();
    if (!name) return showToast('Enter a category name', 'error');
    const emoji = document.getElementById('nc-emoji').value.trim() || '📌';
    const color = document.getElementById('nc-color').value || '#F472B6';
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36);
    await db.put('categories', { id, name, emoji, color });
    state.categories = await db.getAll('categories');
    closeModal('new-cat-modal');
    showToast(`${emoji} ${name} added!`);
    renderView();
  });

  // Save rules
  document.getElementById('save-rules')?.addEventListener('click', async () => {
    const rows = document.querySelectorAll('.rule-row');
    for (const row of rows) {
      const id = parseInt(row.dataset.id);
      const kw = row.querySelector('.rule-kw').value.trim().toLowerCase();
      const cat = row.querySelector('.rule-cat').value;
      if (kw && cat) await db.put('merchant_rules', { id, keyword: kw, categoryId: cat });
    }
    state.merchantRules = await db.getAll('merchant_rules');
    showToast('Rules saved!');
  });

  // Add rule
  document.getElementById('add-rule-btn')?.addEventListener('click', async () => {
    const kw = prompt('Merchant keyword (e.g. "swiggy"):');
    if (!kw) return;
    await db.add('merchant_rules', { keyword: kw.toLowerCase(), categoryId: 'other' });
    renderView();
  });

  // Delete rule
  document.querySelectorAll('.rule-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await db.delete('merchant_rules', parseInt(btn.dataset.id));
      renderView();
    });
  });
}

// ─── File Download Helper ─────────────────────────────────────────────────────
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Persistent Storage Request ──────────────────────────────────────────────
async function requestPersistentStorage() {
  if (!navigator.storage?.persist) { state.storagePersisted = false; return; }
  const already = await navigator.storage.persisted();
  if (already) { state.storagePersisted = true; return; }
  const granted = await navigator.storage.persist();
  state.storagePersisted = granted;
}

// Returns true when running in Safari browser while a standalone PWA install exists.
// On iOS, window.navigator.standalone is true only inside the installed PWA.
function isRunningInSafariInsteadOfPWA() {
  // navigator.standalone is iOS-only: undefined in other browsers
  if (typeof window.navigator.standalone === 'undefined') return false;
  return window.navigator.standalone === false;
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  await bootstrap();
  await cleanupPendingMerchants();
  await requestPersistentStorage();
  await loadFromGist();
  // Re-read state in case Gist replaced categories/rules
  state.categories = await db.getAll('categories');
  state.merchantRules = await db.getAll('merchant_rules');
  await handleURLParams();

  // Nav clicks
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.view === 'add') state.editingExpense = null;
      setView(el.dataset.view);
    });
  });

  // Close modals on back gesture (popstate)
  window.addEventListener('popstate', closeAllModals);

  // Initial render
  renderView();
}

document.addEventListener('DOMContentLoaded', init);
