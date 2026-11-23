import { db } from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES } from './categories.js';
import { playAdd, playDelete, playNav, playBudgetWarn, toggleSound, playCategorySound } from './audio.js';
import {
  initGatekeeper,
  renderGatekeeper,
  mountGatekeeper,
  openLogImpulseModal,
  openEditImpulseModal,
  updateGatekeeperBadge,
  getGatekeeperItems,
  isSampleImpulseBuy
} from './gatekeeper.js';

let _particlesRAF = null;

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  categories: [],
  merchantRules: [],
  currentMonth: '',          // 'YYYY-MM'
  editingExpense: null,
  filterCategory: null,
  filterType: 'all',         // 'all' | 'debit' | 'credit'
  filterDateRange: 'month',  // 'month' | 'last_month' | '30days' | 'all'
  searchQuery: '',
  pictureMode: false,
  chart: null,
  trendChart: null,
  barChart: null,
  storagePersisted: null,    // null=unknown, true=safe, false=at-risk
  sortCol: 'date',
  sortDir: 'desc',
  gmailSyncResult: null,
  gmailPendingImport: [],
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true',
  selectedCreditCard: 'all',
  creditCards: [],
  undoItem: null,
  undoTimer: null,
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

function fmtCurrency(amount, forceDecimals = true) {
  const num = Number(amount) || 0;
  const isNeg = num < 0;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-IN', {
    minimumFractionDigits: forceDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return (isNeg ? '-' : '') + '₹' + formatted;
}

function fmt(amount) {
  return fmtCurrency(amount, true);
}

function getMerchantInitial(name) {
  if (!name || typeof name !== 'string') return '?';
  const clean = name.trim().replace(/^[^a-zA-Z0-9]+/, '');
  return clean ? clean.charAt(0).toUpperCase() : '?';
}

function getMerchantColor(name) {
  if (!name) return '#D99B84';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const colors = [
    '#D99B84', '#DFC498', '#8FA998', '#B6899A', '#C9B7A6',
    '#B39D82', '#D4A373', '#7FB093', '#A0849D', '#C2847A'
  ];
  return colors[Math.abs(hash) % colors.length];
}

function parseAmount(str) {
  return parseFloat(String(str).replace(/[^\d.]/g, '')) || 0;
}

function getCat(id) {
  return state.categories.find(c => c.id === id) || { id: 'other', name: 'Other', emoji: '💫', color: '#A89B95' };
}

function isSavingsCategory(catId) {
  if (!catId) return false;
  const id = String(catId).toLowerCase().trim();
  if (id === 'savings' || id === 'saving') return true;
  const cat = getCat(id);
  if (cat && cat.name && cat.name.toLowerCase().trim() === 'savings') return true;
  return false;
}

function getBudgetsForMonth(allBudgets, targetMonth) {
  if (!allBudgets || allBudgets.length === 0) return [];
  const direct = allBudgets.filter(b => b.month === targetMonth);
  if (direct.length > 0) return direct;
  // If no direct budgets for targetMonth, carry forward from the most recent month with budgets
  const months = Array.from(new Set(allBudgets.map(b => b.month).filter(Boolean))).sort();
  if (months.length > 0) {
    const prior = months.filter(m => m <= targetMonth);
    const chosen = prior.length > 0 ? prior[prior.length - 1] : months[months.length - 1];
    return allBudgets.filter(b => b.month === chosen);
  }
  return [];
}

function getCatBadge(cat, size = 14) {
  if (!cat) return '';
  const id = (cat.id || '').toLowerCase();
  const strokeColor = cat.color || '#DFC498';

  const icons = {
    bills: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/></svg>`,
    food: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
    groceries: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    shopping: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 11V7a4 4 0 0 0-8 0v4"/><path d="M5 9h14l1 12H4L5 9z"/></svg>`,
    transport: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    savings: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/></svg>`,
    debt: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    'debt repayment': `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    entertainment: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    health: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
    education: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10"/><path d="M6 10h10"/></svg>`,
    travel: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    rent: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    other: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${strokeColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  };

  let matchedIcon = icons[id];
  if (!matchedIcon) {
    if (id.includes('bill') || id.includes('utility')) matchedIcon = icons.bills;
    else if (id.includes('food') || id.includes('dine') || id.includes('restaurant')) matchedIcon = icons.food;
    else if (id.includes('grocer') || id.includes('supermarket')) matchedIcon = icons.groceries;
    else if (id.includes('shop') || id.includes('cloth') || id.includes('gift')) matchedIcon = icons.shopping;
    else if (id.includes('transport') || id.includes('travel') || id.includes('fuel') || id.includes('cab') || id.includes('auto')) matchedIcon = icons.transport;
    else if (id.includes('saving') || id.includes('invest') || id.includes('allowance')) matchedIcon = icons.savings;
    else if (id.includes('debt') || id.includes('loan') || id.includes('emi') || id.includes('card')) matchedIcon = icons.debt;
    else if (id.includes('entertain') || id.includes('movie') || id.includes('fun')) matchedIcon = icons.entertainment;
    else if (id.includes('health') || id.includes('medic') || id.includes('doctor')) matchedIcon = icons.health;
    else if (id.includes('educat') || id.includes('course') || id.includes('book')) matchedIcon = icons.education;
    else if (id.includes('rent') || id.includes('house') || id.includes('home')) matchedIcon = icons.rent;
  }

  if (matchedIcon) {
    return `<span class="cat-line-icon-badge" style="background:${cat.color}18;border:1px solid ${cat.color}35">${matchedIcon}</span>`;
  }
  return `<span class="cat-line-icon-badge cat-custom-icon" style="background:${cat.color}18;border:1px solid ${cat.color}35">${cat.emoji || '✨'}</span>`;
}

function dateToMonth(dateStr) {
  return dateStr.slice(0, 7);
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function showToast(msg, type = 'success', action = null) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icon = type === 'error' ? '✕' : type === 'warn' ? '⚠️' : '✓';
  t.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${msg}</span>
    ${action ? `<button class="toast-undo-btn" id="toast-action-btn">${action.label}</button>` : ''}
  `;
  document.body.appendChild(t);
  if (action && action.onClick) {
    t.querySelector('#toast-action-btn')?.addEventListener('click', () => {
      action.onClick();
      t.remove();
    });
  }
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, action ? 5000 : 2600);
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

// ─── Add Expense Modal ────────────────────────────────────────────────────────
function openAddModal(editData = null) {
  state.editingExpense = editData || null;
  document.getElementById('add-modal-body').innerHTML = renderAddForm(editData);
  openModal('add-modal');
  mountAddForm(true);
  // close on backdrop click
  const el = document.getElementById('add-modal');
  el._backdropHandler = e => { if (e.target === el) closeAddModal(); };
  el.addEventListener('click', el._backdropHandler);
  setTimeout(() => el?.querySelector('.amount-input')?.focus(), 80);
}

function closeAddModal() {
  closeModal('add-modal');
  state.editingExpense = null;
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
  const smartOn = await db.getSetting('smart_categorize', true);
  if (!smartOn) return;
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
      showToast(`Saved "${merchant}" → ${getCat(entry.categoryId).emoji} ${getCat(entry.categoryId).name} permanently`);
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
      const [expenses, categories, budgets, merchantRules, rawGatekeeper] = await Promise.all([
        db.getAll('expenses'), db.getAll('categories'),
        db.getAll('budgets'), db.getAll('merchant_rules'),
        getGatekeeperItems().catch(() => db.getAll('gatekeeper').catch(() => [])),
      ]);
      const gatekeeper = (rawGatekeeper || []).filter(g => !isSampleImpulseBuy(g));
      const learnedMerchants = await db.getSetting('learned_merchants', {});
      const pendingMerchants = await db.getSetting('pending_merchants', {});
      const creditCards = await db.getSetting('credit_cards', null);
      const creditCardPayments = await db.getSetting('credit_card_payments', []);

      const payload = JSON.stringify({
        version: 3, syncedAt: Date.now(),
        expenses, categories, budgets, merchantRules, learnedMerchants, pendingMerchants,
        creditCards, creditCardPayments, gatekeeper
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
    if (data.gatekeeper?.length) {
      await db.clearStore('gatekeeper').catch(() => {});
      const cleanGk = data.gatekeeper.filter(g => !isSampleImpulseBuy(g));
      for (const g of cleanGk) await db.put('gatekeeper', g).catch(() => {});
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('gatekeeper_items', JSON.stringify(cleanGk)); } catch (_) {}
      }
      if (cleanGk.length !== data.gatekeeper.length) {
        setTimeout(() => gistSync(), 600);
      }
    }
    if (data.learnedMerchants) await db.setSetting('learned_merchants', data.learnedMerchants);
    if (data.pendingMerchants) await db.setSetting('pending_merchants', data.pendingMerchants);
    if (Array.isArray(data.creditCards)) await db.setSetting('credit_cards', data.creditCards);
    if (Array.isArray(data.creditCardPayments)) await db.setSetting('credit_card_payments', data.creditCardPayments);

  } catch (err) {
    console.warn('Gist load failed:', err.message);
  }
}

// ─── SMS Parsing ─────────────────────────────────────────────────────────────
// ─── Gmail HDFC Integration ───────────────────────────────────────────────────
const GMAIL_CLIENT_ID = '512722575041-daini48eq5hogm3441c6h8tf82nscov6.apps.googleusercontent.com';
let _gisTokenClient = null;

async function loadGIS() {
  if (window.google?.accounts?.oauth2) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function initGISClient(callback) {
  _gisTokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GMAIL_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback,
  });
  return _gisTokenClient;
}

function gmailConnectClick() {
  if (!window.google?.accounts?.oauth2) {
    showToast('Still loading Google auth — please try again in a moment', 'error');
    return;
  }
  try {
    initGISClient(async response => {
      if (response.error) { showToast('Gmail auth failed: ' + response.error, 'error'); return; }
      await db.setSetting('gmail_token', response.access_token);
      await db.setSetting('gmail_token_expiry', Date.now() + (response.expires_in || 3600) * 1000);
      // Store email hint so future token refreshes can be silent
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo',
          { headers: { Authorization: `Bearer ${response.access_token}` } });
        if (r.ok) { const u = await r.json(); if (u.email) await db.setSetting('gmail_hint', u.email); }
      } catch {}
      showToast('Gmail connected!', 'success');
      renderView();
    });
    _gisTokenClient.requestAccessToken({ prompt: 'select_account' });
  } catch (err) {
    showToast('Gmail auth error: ' + err.message, 'error');
  }
}

// Silently get a new token using the stored email hint — no UI shown if Google session is active
async function silentRefreshGmailToken() {
  const hint = await db.getSetting('gmail_hint', null);
  if (!hint) return null;
  try { await loadGIS(); } catch { return null; }
  if (!window.google?.accounts?.oauth2) return null;
  return new Promise(resolve => {
    try {
      initGISClient(async response => {
        if (response.error) { resolve(null); return; }
        await db.setSetting('gmail_token', response.access_token);
        await db.setSetting('gmail_token_expiry', Date.now() + (response.expires_in || 3600) * 1000);
        resolve(response.access_token);
      });
      _gisTokenClient.requestAccessToken({ prompt: '', hint });
    } catch { resolve(null); }
  });
}

async function getGmailToken() {
  const token = await db.getSetting('gmail_token', null);
  const expiry = await db.getSetting('gmail_token_expiry', 0);
  if (token && Date.now() < expiry - 60000) return token;
  // Token missing or expired — try silent background refresh
  return silentRefreshGmailToken();
}

function stripHtmlTags(html) {
  if (!html) return '';
  return html
    // Convert block elements and table cells to newlines to preserve key-value layout
    .replace(/<\/(?:td|th|tr|p|div|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<(?:br\s*\/?>|tr\b[^>]*>|p\b[^>]*>|div\b[^>]*>)/gi, '\n')
    .replace(/<(?:td|th)\b[^>]*>/gi, '\n')
    // Strip all remaining HTML tags
    .replace(/<[^>]+>/g, ' ')
    // Decode HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Normalize horizontal whitespace per line and keep meaningful line breaks
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function decodeBase64Utf8(data) {
  try {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    try { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
  }
}

function extractEmailText(payload) {
  let plainTexts = [];
  let htmlTexts = [];

  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const decoded = decodeBase64Utf8(part.body.data);
      if (decoded.trim()) plainTexts.push(decoded.trim());
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      const decoded = decodeBase64Utf8(part.body.data);
      if (decoded.trim()) htmlTexts.push(stripHtmlTags(decoded));
    }
    for (const sub of part.parts || []) {
      walk(sub);
    }
  }

  walk(payload);

  const plainCombined = plainTexts.join('\n');
  const htmlCombined = htmlTexts.join('\n');

  const isTxn = t => /(?:debited|spent|paid|deducted|transaction|transferred|₹|â‚¹|Rs\.?|INR)/i.test(t);

  // If plain text has clear transaction details, check if HTML provides richer table line breaks
  if (plainCombined && isTxn(plainCombined) && plainCombined.length > 35) {
    const plainLines = plainCombined.split('\n').filter(Boolean).length;
    const htmlLines = htmlCombined.split('\n').filter(Boolean).length;
    if (htmlLines > plainLines + 2 && isTxn(htmlCombined)) {
      return htmlCombined;
    }
    return plainCombined;
  }
  // Otherwise use stripped HTML which contains all styled text and tables
  if (htmlCombined && isTxn(htmlCombined)) {
    return htmlCombined;
  }
  return plainCombined || htmlCombined || '';
}

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function formatTimeIST(dateObjOrMs) {
  try {
    const d = new Date(dateObjOrMs);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(d).toUpperCase();
  } catch (_) {
    return '';
  }
}

function normalizeTime(rawTime, fallbackDateMs) {
  if (rawTime) {
    const str = String(rawTime).trim();
    // 1. Matches 12-hour: "10:42 AM", "8:44pm", "08:44:15 PM"
    const m12 = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])/);
    if (m12) {
      let hh = parseInt(m12[1], 10);
      const mm = m12[2];
      const meridiem = m12[3].toUpperCase();
      if (hh > 12) hh = hh % 12;
      return `${String(hh).padStart(2, '0')}:${mm} ${meridiem}`;
    }
    // 2. Matches 24-hour: "20:15:30", "14:22", "09:05:00"
    const m24 = str.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
    if (m24) {
      const h24 = parseInt(m24[1], 10);
      const mm = m24[2];
      const meridiem = h24 >= 12 ? 'PM' : 'AM';
      let h12 = h24 % 12;
      if (h12 === 0) h12 = 12;
      return `${String(h12).padStart(2, '0')}:${mm} ${meridiem}`;
    }
  }

  // Fallback to internal timestamp converted to IST (Asia/Kolkata)
  if (fallbackDateMs) {
    return formatTimeIST(fallbackDateMs);
  }
  return '';
}

function extractTimeFromText(body, fallbackDateMs) {
  if (!body) return fallbackDateMs ? formatTimeIST(fallbackDateMs) : '';

  // 1. "at 10:42 AM", "at 20:15:30", "at 08:44 PM"
  const atTime = body.match(/\bat\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\b/);
  if (atTime) {
    const t = normalizeTime(atTime[1], null);
    if (t) return t;
  }

  // 2. Date followed by time: "16-11-2026 20:15:30", "16-Nov-26 14:22:10", "16/11/2026 15:30:10"
  const dateTime = body.match(/\b\d{1,2}[-/ ][A-Za-z0-9]{3,}[-/ ]\d{2,4}\s+(?:at\s+)?(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\b/);
  if (dateTime) {
    const t = normalizeTime(dateTime[1], null);
    if (t) return t;
  }

  // 3. "time: 14:22", "time : 08:44 PM"
  const timeLabel = body.match(/\btime\s*:?\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)\b/i);
  if (timeLabel) {
    const t = normalizeTime(timeLabel[1], null);
    if (t) return t;
  }

  // 4. Any 12-hour time: "10:42 AM", "08:44 PM"
  const any12 = body.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp][Mm])\b/);
  if (any12) {
    const t = normalizeTime(any12[1], null);
    if (t) return t;
  }

  // 5. Any 24-hour time with seconds: "20:15:30"
  const any24Sec = body.match(/\b([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)\b/);
  if (any24Sec) {
    const t = normalizeTime(any24Sec[0], null);
    if (t) return t;
  }

  // Fallback to internalDate in IST (Asia/Kolkata)
  return fallbackDateMs ? formatTimeIST(fallbackDateMs) : '';
}

function normalizeDate(rawDate, fallbackDateMs) {
  if (!rawDate) {
    if (fallbackDateMs) {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(fallbackDateMs));
      } catch (_) {}
      return new Date(fallbackDateMs).toISOString().slice(0, 10);
    }
    return new Date().toISOString().slice(0, 10);
  }
  let m = rawDate.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    const [, dd, mm, yy] = m;
    const year = yy.length <= 2 ? '20' + yy.padStart(2, '0') : yy;
    return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  m = rawDate.match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2,4})/);
  if (m) {
    const [, dd, mon, yy] = m;
    const mm = MONTH_MAP[mon.toLowerCase()] || '01';
    const year = yy.length <= 2 ? '20' + yy.padStart(2, '0') : yy;
    return `${year}-${mm}-${dd.padStart(2, '0')}`;
  }
  return fallbackDateMs
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(fallbackDateMs))
    : new Date().toISOString().slice(0, 10);
}

const BOILERPLATE_PATTERNS = [
  /we\s+(?:wish|would\s+like)\s+to\s+inform\s+you\s+that/gi,
  /this\s+is\s+to\s+inform\s+you\s+that/gi,
  /please\s+note\s+that/gi,
  /thank\s+you\s+for\s+(?:banking\s+with|using)\s+[A-Za-z\s]+/gi,
  /dear\s+(?:customer|cardmember|user|sbi\s+upi\s+user|valuable\s+customer)/gi,
  /your\s+(?:account|a\/c|bank\s+account|card)\s+(?:ending\s+with\s+)?(?:\*+|\d+)/gi,
  /if\s+you\s+did\s+not\s+(?:make|authorize)\s+this/gi,
  /never\s+share\s+your\s+(?:otp|password|pin|cvv)/gi,
];

function isBankName(str, bank = '') {
  if (!str) return false;
  const s = String(str).toLowerCase().trim();
  if (bank && s === String(bank).toLowerCase().trim()) return true;
  return /^(?:hdfc|hdfc\s+bank|sbi|sbicard|sbi\s+card|sbi\s+credit|sbi\s+savings|state\s+bank|state\s+bank\s+of\s+india|slice|sliceit|slice\s+credit|slice\s+savings|slice\s+account|nesfb|icici|icici\s+bank|union\s+bank|union\s+bank\s+of\s+india|ubi|axis|axis\s+bank|kotak|kotak\s+mahindra|idfc|idfc\s+first|canara|canara\s+bank|pnb|punjab\s+national\s+bank|bob|bank\s+of\s+baroda|indusind|federal\s+bank|yes\s+bank|onecard|bank|bank\s+account|credit\s+card|debit\s+card)\b/i.test(s);
}

const MERCHANT_STOPWORDS = new Set([
  // Explicit blocklist for footer / support / boilerplate terms
  'help', 'line', 'help line', 'helpline', 'team',
  'support', 'customer support', 'customer care', 'care',
  'digital', 'safety', 'tips', 'safety tips', 'security',
  'customer', 'dear customer', 'valuable customer',
  'slice', 'sliceit', 'slice debit', 'slice card', 'slice credit', 'slice savings', 'slice account', 'nesfb',
  'hdfc', 'hdfc bank', 'hdfc debit', 'hdfc credit',
  'sbi', 'sbi card', 'sbi debit', 'sbi upi', 'sbi credit card', 'sbi savings', 'state bank of india',
  'icici', 'icici bank', 'icici debit',
  'union bank', 'union bank of india', 'ubi',
  'axis', 'axis bank', 'kotak', 'idfc', 'canara', 'pnb', 'bob',
  'indusind', 'federal bank', 'yes bank', 'onecard',
  'account', 'your account', 'bank account', 'a/c', 'your a/c',
  'bank',
  'your', 'the', 'this', 'that', 'our', 'you',
  'view', 'click', 'download',
  'card', 'credit card', 'debit card',
  'upi', 'vpa', 'not', 'check', 'call', 'contact', 'sms', 'otp',
  'ref', 'reference', 'rrn', 'utr', 'txn', 'transaction', 'alert', 'update',
  'avl', 'bal', 'available balance', 'total', 'amount',
  'online', 'payment', 'successful', 'completed', 'using', 'towards',
  'unknown merchant', 'unknown',
  'inform', 'inform you', 'inform you that', 'inform you that rs',
  'queries', 'query', 'grievance', 'report', 'fraud', 'notice',
  'toll free', 'toll-free', 'tollfree'
]);

function stripBoilerplate(text) {
  if (!text) return '';
  let cleaned = text;
  for (const bp of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(bp, ' ');
  }
  return cleaned
    .split('\n')
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanUpiHandle(handle) {
  if (!handle) return '';
  let name = String(handle).trim().replace(/^vpa\s*:?\s*/i, '');
  if (name.includes('@')) name = name.split('@')[0];
  // Strip gateway prefixes: rzp., razorpay., cashfree., billdesk.
  name = name.replace(/^(?:rzp|razorpay|cashfree|billdesk)[._\-]/i, '');
  // Strip trailing numbers attached with separators
  name = name.replace(/[-_.][0-9]+$/g, '');
  // If not purely a phone number / digits, strip trailing digits: rahul12345 -> rahul
  if (!/^\d+$/.test(name)) {
    name = name.replace(/\d+$/g, '');
  }
  // Strip payment suffixes like swiggyupi -> swiggy, zomato_pay -> zomato
  name = name.replace(/^([a-zA-Z]{3,})(?:upi|pay|merchant|razorpay|rzp|cashfree|bharatpe|phonepe|gpay|paytm)$/i, '$1');
  // Replace separators with space
  name = name.replace(/[._\-+]/g, ' ').trim();

  const words = name.split(/\s+/).filter(Boolean);
  const filtered = words.filter(w => !/^(rzp|pay|merchant|pos|mpos|qr|vpa|upi|razorpay|cashfree|bharatpe|gpay|phonepe|billdesk|ccavenue|direct|pg)$/i.test(w));
  const finalWords = filtered.length > 0 ? filtered : words;

  if (finalWords.length === 1 && /^\d{10}$/.test(finalWords[0])) {
    return 'UPI · ' + finalWords[0];
  }
  return finalWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function cleanMerchantName(str, bank = '') {
  if (!str) return '';
  let cleaned = str
    .replace(/^[@\-_.:\s"'“”‘’]+|[@\-_.:\s"'“”‘’]+$/g, '')
    .replace(/^(?:vpa|to|towards|at|paid\s+to|transfer\s+to|transferred\s+to|sent\s+to|refund\s+from|cashback\s+from|received\s+from)\s+/i, '')
    .replace(/\s+(?:on\b|using\b|via\b|ref\b|upi\b|date\b|rrn\b).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.includes('@')) {
    cleaned = cleanUpiHandle(cleaned);
  }

  if (cleaned === cleaned.toLowerCase() || (cleaned === cleaned.toUpperCase() && cleaned.length > 3)) {
    cleaned = cleaned.split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  const lower = cleaned.toLowerCase();
  if (MERCHANT_STOPWORDS.has(lower)) return '';
  if (isBankName(cleaned, bank)) return '';

  // Reject boilerplate beginnings / single words
  if (/^(?:inform|view|notify|check|call|your|our|the\b(?!\s+[A-Za-z]+)|this|that|please|an?\s+amount|know|report|update|dispute)\b/i.test(cleaned)) {
    return '';
  }

  // Reject sentences or overly long strings
  if (cleaned.split(/\s+/).length > 6 || cleaned.length > 40) {
    return '';
  }

  // Reject footer / help phrases anywhere in candidate
  if (/\b(?:help\s*line|helpline|customer\s*care|customer\s*support|safety\s*tips|toll\s*free|need\s*help|click\s*here)\b/i.test(lower)) {
    return '';
  }

  // Reject if candidate is just 1 character or purely numbers/symbols
  if (cleaned.length < 2 || /^[^a-zA-Z]+$/.test(cleaned)) {
    return '';
  }

  return cleaned;
}

function classifyTransactionDirection(body, subject = '') {
  const text = `${subject} ${body}`.toLowerCase();
  const withoutNotCredited = text.replace(/not\s+credited/gi, '').replace(/if.*?credited/gi, '');

  const hasCreditIntent =
    /(?:account|a\/c|card)\s+(?:has\s+been|is|was)?\s*credited/i.test(withoutNotCredited) ||
    /(?:credited|received)\s+(?:with|by|for|into)\s*(?:rs\.?|inr|₹|â‚¹)/i.test(withoutNotCredited) ||
    /(?:rs\.?|inr|₹|â‚¹)\s*[\d,]+(?:\.\d{1,2})?\s+(?:is|has\s+been|was)?\s*credited/i.test(withoutNotCredited) ||
    /(?:refund\s+(?:of|from)|cashback\s+(?:of|from)|reversed|reversal\s+of|money\s+received\s+from|received\s+from)\b/i.test(withoutNotCredited);

  const hasDebitIntent =
    /(?:debited|spent|paid\s+to|sent\s+to|transfer\s+to|transferred\s+to|purchase\s+at|charged\s+to|withdrawn\s+from)/i.test(text) ||
    /(?:debit\s+alert|transaction\s+alert)/i.test(subject);

  if (hasCreditIntent && !hasDebitIntent) return 'credit';
  if (hasCreditIntent && hasDebitIntent) {
    const creditIdx = text.search(/credited|refund|cashback|reversed|received/);
    const debitIdx = text.search(/debited|spent|paid|purchase|withdrawn/);
    return (creditIdx !== -1 && (debitIdx === -1 || creditIdx < debitIdx)) ? 'credit' : 'debit';
  }
  return 'debit';
}

function detectPaymentMethod(body, bank = '') {
  if (bank === 'SBI Credit Card' || bank === 'Slice Credit' || bank === 'HDFC Credit Card') {
    return 'Card';
  }
  if (bank === 'Slice Savings Account' || bank === 'SBI Savings Account') {
    if (/neft|imps|rtgs|netbanking|internet\s+banking|funds?\s+transfer|\binb\b/i.test(body)) {
      return 'Transfer';
    }
    if (/debit\s*card/i.test(body)) {
      return 'Card';
    }
    return 'UPI';
  }
  if (/upi|vpa|@ok[a-z]+|@okhdfcbank|@okaxis|@oksbi|@ybl|@paytm|@ibl|@axl|@apl|@upi|upi\/p2m|upi\/p2a|upi\s*ref/i.test(body)) {
    return 'UPI';
  }
  if (/neft|imps|rtgs|netbanking|internet\s+banking|funds?\s+transfer|\binb\b/i.test(body)) {
    return 'Transfer';
  }
  if (/credit\s*card|card\s+ending|\bpos\b|\becom\b|spent\s+on\s+your\s+.*?card/i.test(body)) {
    return 'Card';
  }
  if (/atm|cash\s+withdrawal/i.test(body)) {
    return 'Cash';
  }
  if (/slice\s+credit/i.test(bank)) {
    return 'Card';
  }
  return 'UPI';
}

function extractMerchantFromText(body, strippedBody, bank = '') {
  const text = strippedBody || body;

  // 1. Bracket inside VPA: to VPA swiggyupi@axisbank (Swiggy)
  const vpaBracket = body.match(/VPA\s+\S+\s*\(([^)]+)\)/i);
  if (vpaBracket) {
    const candidate = cleanMerchantName(vpaBracket[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 2. Table / Standalone "To" / "Payee" key-value layout (Slice, HDFC, bank alerts)
  // Matches "To\nSWIGGY" or "To: SWIGGY" or "To   SWIGGY" up to newline or RRN / Ref
  const tableToMatch = text.match(/\bTo\b\s*:?\s*\n+\s*([^\n\r]+)/i) ||
                       body.match(/\bTo\b\s*:?\s*\n+\s*([^\n\r]+)/i) ||
                       text.match(/^\s*To\b\s*:?\s*([^\n\r]+)/im) ||
                       body.match(/^\s*To\b\s*:?\s*([^\n\r]+)/im) ||
                       body.match(/\bTo\b\s{2,}([^\n\r]+)/i);
  if (tableToMatch && tableToMatch[1]) {
    let raw = tableToMatch[1].split(/\b(?:RRN|Ref|UTR|Txn|Date)\b/i)[0].trim();
    const candidate = cleanMerchantName(raw, bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // Other table labels: Payee, Beneficiary Name, Merchant
  const tablePayeeMatch = text.match(/\b(?:Payee|Beneficiary(?:\s+Name)?|Merchant(?:\s+Name)?)\b\s*:?\s*(?:\n+|\s{2,}|\s*:?\s*)([^\n\r]+)/i) ||
                          body.match(/\b(?:Payee|Beneficiary(?:\s+Name)?|Merchant(?:\s+Name)?)\b\s*:?\s*(?:\n+|\s{2,}|\s*:?\s*)([^\n\r]+)/i);
  if (tablePayeeMatch && tablePayeeMatch[1]) {
    let raw = tablePayeeMatch[1].split(/\b(?:RRN|Ref|UTR|Txn|Date|Account|A\/c)\b/i)[0].trim();
    const candidate = cleanMerchantName(raw, bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  // 3. HDFC / Bank VPA Payee extraction:
  // "to VPA <upi-id> <Merchant Name> on <date>" OR "to VPA <upi-id> (<Merchant Name>) on <date>"
  const toVpaWithName = body.match(/(?:to|towards|transfer\s+to|transferred\s+to|by\s+transfer\s+to)\s+VPA\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)(?:\s*\(([^)]+)\)|\s+([A-Za-z0-9 &.'\-]{2,40}?))?(?:\s+on\b|\s+using\b|\s+via\b|\s+Ref\b|\s+UPI\b|\.|\n|$)/i);
  if (toVpaWithName) {
    const vpaHandle = toVpaWithName[1];
    const bracketName = toVpaWithName[2];
    const trailingName = toVpaWithName[3];

    if (bracketName) {
      const c = cleanMerchantName(bracketName, bank);
      if (c && !isBankName(c, bank) && !MERCHANT_STOPWORDS.has(c.toLowerCase())) return c;
    }
    if (trailingName && !/^(?:on|using|via|ref|upi|date)\b/i.test(trailingName.trim())) {
      const c = cleanMerchantName(trailingName, bank);
      if (c && !isBankName(c, bank) && !MERCHANT_STOPWORDS.has(c.toLowerCase())) return c;
    }
    const c = cleanUpiHandle(vpaHandle);
    if (c && !isBankName(c, bank) && !MERCHANT_STOPWORDS.has(c.toLowerCase())) return c;
  }

  // 4. UPI Info line: Info: UPI/12345/Merchant/Bank or Info: UPI/Merchant/12345 or towards UPI/12345/Merchant
  const infoMatch = body.match(/(?:Info:\s*|towards\s+)?UPI\/(?:\d+\/)?([A-Za-z0-9 &._\-]+?)(?:\/|$|\s)/i);
  if (infoMatch && infoMatch[1] && !/^\d+$/.test(infoMatch[1])) {
    const candidate = cleanMerchantName(infoMatch[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 5. "payment [of Rs X] to <Merchant>" / "payment to <Merchant> of Rs X was successful"
  const paymentToMatch = text.match(/payment\s+(?:of\s+[^.]+?\s+)?to\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:was\s+successful|successful|completed|of\b|using\b|on\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i);
  if (paymentToMatch) {
    const candidate = cleanMerchantName(paymentToMatch[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 6. Refunds / cashbacks / credits: "refund [of Rs X] from <Merchant>" / "received [Rs X] from <Merchant>"
  const refundMatch = text.match(/(?:refund|cashback|received|money\s+received)\s+(?:of\s+)?(?:(?:an?\s+)?amount\s+(?:of\s+)?)?(?:(?:Rs\.?|INR|₹|â‚¹)\s*[\d,]+(?:\.\d{1,2})?\s+)?from\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:was\s+credited|credited|received|on\b|using\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i) ||
                      text.match(/(?:refund|cashback|received)\s+from\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:was\s+credited|credited|received|on\b|using\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i);
  if (refundMatch) {
    const candidate = cleanMerchantName(refundMatch[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 7. Action patterns: "paid [Rs X] to <Merchant>", "transferred [Rs X] to <Merchant>", "sent [Rs X] to <Merchant>", "transfer to <Merchant>", "towards <Merchant>"
  const actionMatch = text.match(/(?:paid|transferred|transfer|sent)\s+(?:(?:an?\s+)?amount\s+(?:of\s+)?|(?:Rs\.?|INR|₹|â‚¹)\s*[\d,]+(?:\.\d{1,2})?\s+)?to\s+(?:VPA\s+)?([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:on\b|using\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i) ||
                      text.match(/(?:towards|paid\s+to|transfer\s+to|transferred\s+to|sent\s+to)\s+(?:VPA\s+)?([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:on\b|using\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i);
  if (actionMatch) {
    const candidate = cleanMerchantName(actionMatch[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 8. "at <Merchant> using slice" or "at <Merchant> on..."
  const atMatch = text.match(/\bat\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+(?:using\b|on\b|via\b|Ref\b|UPI\b|UTR\b|\.|\n|$|Rs\.?|INR|₹))/i);
  if (atMatch) {
    const candidate = cleanMerchantName(atMatch[1], bank);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  // 9. Bare VPA handle anywhere: e.g. swiggyupi@axisbank or VPA rahul@okaxis
  const bareVpa = body.match(/\b([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)\b/i);
  if (bareVpa) {
    const candidate = cleanUpiHandle(bareVpa[1]);
    if (candidate && !isBankName(candidate, bank) && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  return /atm|cash withdrawal/i.test(body) ? `${bank || 'Bank'} ATM` : 'Unknown Merchant';
}

function detectBank(from = '', subject = '', body = '') {
  const f = (from || '').toLowerCase();
  const sub = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();

  // 1. Check sender address first (most authoritative)
  if (f.includes('sbicard')) return 'SBI Credit Card';
  if (f.includes('sbi')) {
    if (sub.includes('card') || b.includes('card') || b.includes('credit') || sub.includes('credit')) return 'SBI Credit Card';
    return 'SBI Savings Account';
  }
  if (f.includes('hdfc')) {
    if (sub.includes('credit card') || b.includes('credit card')) return 'HDFC Credit Card';
    return 'HDFC Bank';
  }
  if (f.includes('sliceit') || f.includes('slice')) {
    if (b.includes('slice account') || b.includes('slice savings') || b.includes('savings a/c') || b.includes('nesfb') || (b.includes('upi') && !b.includes('borrow') && !b.includes('card ending') && !b.includes('slice card'))) {
      return 'Slice Savings Account';
    }
    return 'Slice Credit';
  }
  if (f.includes('icici')) return 'ICICI';
  if (f.includes('unionbank') || f.includes('ubi')) return 'Union Bank';
  if (f.includes('axis')) return 'Axis';
  if (f.includes('kotak')) return 'Kotak';
  if (f.includes('idfc')) return 'IDFC FIRST';
  if (f.includes('onecard') || f.includes('fplabs')) return 'OneCard';
  if (f.includes('canarabank')) return 'Canara Bank';
  if (f.includes('pnb')) return 'PNB';
  if (f.includes('bankofbaroda') || f.includes('bob')) return 'Bank of Baroda';
  if (f.includes('indusind')) return 'IndusInd';
  if (f.includes('federalbank')) return 'Federal Bank';
  if (f.includes('yesbank')) return 'Yes Bank';

  // 2. Check subject line & body for SBI & Slice
  if (sub.includes('sbicard') || (sub.includes('sbi') && (sub.includes('card') || sub.includes('credit')))) return 'SBI Credit Card';
  if (sub.includes('sbi') || sub.includes('state bank')) return 'SBI Savings Account';
  if (b.includes('sbicard') || b.includes('sbi card') || b.includes('sbi credit card')) return 'SBI Credit Card';
  if (b.includes('state bank') || b.includes('sbi account') || b.includes('sbi upi')) return 'SBI Savings Account';

  if (sub.includes('slice')) {
    if (sub.includes('account') || sub.includes('savings') || b.includes('slice account') || b.includes('slice savings') || b.includes('nesfb') || (b.includes('upi') && !b.includes('card ending') && !b.includes('borrow') && !b.includes('slice card'))) {
      return 'Slice Savings Account';
    }
    return 'Slice Credit';
  }
  if (b.includes('slice')) {
    if (b.includes('slice account') || b.includes('slice savings') || b.includes('nesfb') || (b.includes('upi') && !b.includes('borrow') && !b.includes('card ending') && !b.includes('credit limit') && !b.includes('slice card'))) {
      return 'Slice Savings Account';
    }
    return 'Slice Credit';
  }

  // 3. Other bank checks
  const checkStr = (s) => {
    if (s.includes('hdfc')) return 'HDFC Bank';
    if (s.includes('icici')) return 'ICICI';
    if (s.includes('union bank') || s.includes('ubi')) return 'Union Bank';
    if (s.includes('axis')) return 'Axis';
    if (s.includes('kotak')) return 'Kotak';
    if (s.includes('idfc')) return 'IDFC FIRST';
    if (s.includes('onecard')) return 'OneCard';
    if (s.includes('canara')) return 'Canara Bank';
    if (s.includes('pnb') || s.includes('punjab national')) return 'PNB';
    if (s.includes('bank of baroda') || s.includes('bob')) return 'Bank of Baroda';
    if (s.includes('indusind')) return 'IndusInd';
    if (s.includes('federal bank')) return 'Federal Bank';
    if (s.includes('yes bank')) return 'Yes Bank';
    return null;
  };

  const fromSub = checkStr(sub);
  if (fromSub) return fromSub;

  const fromBody = checkStr(b);
  if (fromBody) return fromBody;

  const match = `${subject} ${body}`.match(/\b([A-Z][a-zA-Z]+)\s+Bank\b/);
  if (match) return `${match[1]} Bank`;

  return 'Bank';
}

async function callGeminiParse(emailBody, subject = '', apiKey) {
  if (!apiKey || !apiKey.trim()) return null;
  const prompt = `You are a financial transaction extractor for Indian bank and payment alert emails (e.g. HDFC, SBI, Slice, ICICI, Union Bank, Axis, UPI).
Extract transaction details from this email alert. Return ONLY valid JSON with no markdown formatting.
Schema:
{
  "amount": <number>,
  "type": "debit" | "credit",
  "method": "UPI" | "Card" | "Transfer" | "Cash",
  "merchant": "<clean merchant, store, recipient person, or organization name>",
  "refNo": "<transaction reference or UTR or null>",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM AM/PM or null"
}

CRITICAL RULES FOR MERCHANT:
1. NEVER return bank names (e.g., 'HDFC', 'SBI', 'Slice', 'ICICI', 'Union Bank', 'Axis Bank') as the merchant.
2. NEVER return boilerplate words, email footer text, or helpline phrases (e.g., 'Help', 'Line', 'Help Line', 'Helpline', 'Customer Support', 'Customer Care', 'Safety Tips', 'Team', 'Support', 'Digital').
3. In Slice or bank alerts with multi-line or table key-value pairs (e.g., 'To\\nSWIGGY\\nRRN' or 'To: SWIGGY'), extract the actual payee name following 'To' or 'Payee' (e.g., 'Swiggy').
4. If this is a payment, extract the actual payee/merchant (e.g., from 'paid to <Merchant>', 'transferred to <Merchant>', 'sent to <Merchant>', 'towards <Merchant>', 'at <Merchant>', 'to VPA <upi-id>', or 'To: <Merchant>').
5. If only a UPI ID / VPA is present (such as swiggyupi@axisbank or zappo.store@okicici), clean it to human readable form (e.g., 'Swiggy', 'Zappo Store').
6. If a transfer time is mentioned in the email body, extract it (e.g., '10:42 AM', '20:15:30', '08:44 PM').

Email Subject: ${subject}
Email Content:
${emailBody.slice(0, 1500)}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: 'application/json' }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('Gemini parse failed:', err);
    return null;
  }
}

async function parseBankEmail(body, emailDateMs = Date.now(), subject = '', from = '', geminiApiKey = '') {
  if (!body) return null;

  // 1. Transaction Direction
  let type = classifyTransactionDirection(body, subject);

  // 2. Identify Bank & Method
  const bank = detectBank(from, subject, body);
  let method = detectPaymentMethod(body, bank);

  // 3. Strip Boilerplate & Available Balances
  const strippedBody = stripBoilerplate(body);
  const cleanBody = strippedBody.replace(/(?:available\s+balance|avl\s+bal|ledger\s+balance|total\s+balance|credit\s+limit|avl\s+limit|available\s+limit)[^.,\n]{0,35}?(?:Rs\.?|INR|₹|â‚¹)\s*[\d,]+(?:\.\d{1,2})?/gi, '');

  const CURR = '(?:Rs\\.?|INR|₹|â‚¹)';

  // 4. Extract Amount
  let amount = null;
  const amtPatterns = [
    new RegExp(`(?:debited\\s+(?:by|for|with)|is\\s+debited|has\\s+been\\s+debited|was\\s+debited|debited\\s+from.*?for)\\s*${CURR}?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'),
    new RegExp(`${CURR}\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s+(?:is|has\\s+been|was)?\\s*debited`, 'i'),
    new RegExp(`(?:credited\\s+(?:by|for|with|into)|is\\s+credited|has\\s+been\\s+credited|was\\s+credited)\\s*${CURR}?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'),
    new RegExp(`${CURR}\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s+(?:is|has\\s+been|was)?\\s*credited`, 'i'),
    new RegExp(`(?:spent|transaction\\s+(?:of|for)|payment\\s+(?:of|for)|purchase\\s+(?:of|for)|refund\\s+(?:of|for))\\s+(?:(?:an\\s+amount\\s+of\\s+)?${CURR})?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'),
    new RegExp(`${CURR}\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s+(?:spent|was\\s+spent|deducted)`, 'i'),
    new RegExp(`(?:debited|deducted|transferred|paid|refunded)\\s+${CURR}\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'),
    new RegExp(`${CURR}\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i')
  ];

  for (const p of amtPatterns) {
    const m = cleanBody.match(p);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0) {
        amount = val;
        break;
      }
    }
  }
  if (!amount || amount <= 0) return null;

  // 5. Extract Merchant
  let merchant = extractMerchantFromText(body, strippedBody, bank);

  // 6. Extract Date & Time
  let date = null;
  const dateMatch = body.match(/\bon\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[- ][A-Za-z]{3}[- ]\d{2,4})/i) ||
                    body.match(/\bdate\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[- ][A-Za-z]{3}[- ]\d{2,4})/i);
  date = normalizeDate(dateMatch ? dateMatch[1] : null, emailDateMs);

  let time = extractTimeFromText(body, emailDateMs);

  // 7. Extract Reference Number
  let refNo = null;
  const refPatterns = [
    /(?:reference\s+no\.?|ref\s*no\.?|ref\s*:|upi\s*ref(?:\s*no\.?)?|txn\s*(?:id|#|no\.?)|utr)\s*:?\s*([A-Za-z0-9]{6,25})/i,
    /UPI\/(\d{10,16})/i,
    /\(Ref\s+no\s+(\d+)\)/i
  ];
  for (const rp of refPatterns) {
    const rm = body.match(rp);
    if (rm && rm[1]) {
      refNo = rm[1].trim();
      break;
    }
  }

  // 8. LLM Fallback (if Gemini key configured and merchant is unknown or needs refinement)
  if (geminiApiKey && (merchant === 'Unknown Merchant' || MERCHANT_STOPWORDS.has(merchant.toLowerCase()))) {
    const llm = await callGeminiParse(body, subject, geminiApiKey);
    if (llm && llm.merchant) {
      const cleanedLlm = cleanMerchantName(llm.merchant, bank);
      if (cleanedLlm && !MERCHANT_STOPWORDS.has(cleanedLlm.toLowerCase()) && !isBankName(cleanedLlm, bank)) {
        merchant = cleanedLlm;
        if (llm.type) type = llm.type;
        if (llm.method) method = llm.method;
        if (llm.refNo && !refNo) refNo = llm.refNo;
        if (llm.time) time = normalizeTime(llm.time, emailDateMs) || time;
      }
    }
  }

  let cardId = null;
  if (bank === 'SBI Credit Card' || (method === 'Card' && /sbi/i.test(bank))) {
    cardId = 'sbi';
  }

  return { amount, merchant, date, time, method, refNo, bank, type, cardId };
}

function parseHdfcEmail(body, emailDateMs) {
  return parseBankEmail(body, emailDateMs);
}

function showGmailPreview(transactions, importedRefs) {
  const body = document.getElementById('gmail-preview-body');
  body.innerHTML = `
<div class="import-wrap">
  <h2 class="modal-title">Gmail Transactions Found</h2>
  <p class="import-hint">${transactions.length} new bank transaction${transactions.length !== 1 ? 's' : ''}. Credits are unchecked by default.</p>
  <div class="import-table-wrap">
    <table class="txn-table import-table">
      <thead>
        <tr>
          <th style="width:36px;text-align:center">✓</th>
          <th class="col-datetime" style="min-width:130px">Date & Time</th>
          <th style="width:90px">Type</th>
          <th style="width:85px">Bank</th>
          <th class="col-merchant" style="min-width:200px">Merchant / Payee</th>
          <th class="col-amount" style="width:110px">Amount</th>
          <th class="col-cat" style="min-width:140px">Category</th>
          <th style="width:80px">Method</th>
        </tr>
      </thead>
      <tbody>
        ${transactions.map((t, i) => `
          <tr>
            <td style="text-align:center"><input type="checkbox" class="gmail-import-check" data-i="${i}" ${t.type === 'credit' ? '' : 'checked'}></td>
            <td class="col-datetime" style="white-space:nowrap">
              <div style="font-weight:600;font-size:12.5px;color:var(--text)">${t.date}</div>
              ${t.time ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">${t.time}</div>` : ''}
            </td>
            <td><span class="txn-type-badge txn-type-${t.type || 'debit'}">${t.type === 'credit' ? '🟢 Credit' : '🔴 Debit'}</span></td>
            <td><span class="bank-pill bank-${(t.bank||'bank').toLowerCase().replace(/\s+/g, '-')}">${t.bank||'Bank'}</span></td>
            <td class="col-merchant">
              <input class="import-cell-input import-merchant-input" data-i="${i}" data-f="merchant" value="${(t.merchant||'').replace(/"/g,'&quot;')}" placeholder="Merchant name">
            </td>
            <td><input class="import-cell-input import-amount" data-i="${i}" data-f="amount" value="${t.amount}" type="number" step="0.01"></td>
            <td>
              <select class="import-cell-select" data-i="${i}" data-f="category">
                ${state.categories.map(c => `<option value="${c.id}" ${c.id === t.category ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('')}
              </select>
            </td>
            <td><span class="method-pill method-${(t.method||'upi').toLowerCase()}">${t.method||'UPI'}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  <div class="import-actions" style="margin-top:16px">
    <button class="btn-secondary" id="gmail-preview-cancel">Cancel</button>
    <button class="btn-primary" id="gmail-preview-import">Import Selected →</button>
  </div>
</div>`;
  openModal('gmail-preview-modal');

  document.getElementById('gmail-preview-cancel')?.addEventListener('click', () => closeModal('gmail-preview-modal'));

  document.getElementById('gmail-preview-import')?.addEventListener('click', async () => {
    const checks = document.querySelectorAll('.gmail-import-check');
    let count = 0;
    const newRefs = [...importedRefs];
    for (const chk of checks) {
      if (!chk.checked) continue;
      const i = parseInt(chk.dataset.i);
      const t = transactions[i];
      const merchantEl = document.querySelector(`.import-cell-input[data-i="${i}"][data-f="merchant"]`);
      const amountEl = document.querySelector(`.import-cell-input[data-i="${i}"][data-f="amount"]`);
      const categoryEl = document.querySelector(`.import-cell-select[data-i="${i}"][data-f="category"]`);
      const merchant = merchantEl ? merchantEl.value.trim() : t.merchant;
      const amount = amountEl ? parseFloat(amountEl.value) : t.amount;
      const category = categoryEl ? categoryEl.value : t.category;
      if (!amount || amount <= 0) continue;
      const noteParts = [
        t.bank ? t.bank : '',
        t.type === 'credit' ? 'Credit / Refund' : '',
        t.refNo ? `Ref: ${t.refNo}` : ''
      ].filter(Boolean);
      const expense = {
        date: t.date,
        time: t.time || '',
        month: t.date.slice(0, 7),
        merchant,
        amount,
        category,
        method: t.method || 'UPI',
        type: t.type || 'debit',
        bank: t.bank || '',
        cardId: t.cardId || null,
        note: noteParts.join(' · '),
        createdAt: Date.now()
      };
      await db.add('expenses', expense);
      newRefs.push(t._dupeKey || (t.refNo ? t.refNo : `msg:${t.id}`));
      count++;
    }
    await db.setSetting('gmail_imported_refs', newRefs);
    // Update rows: mark imported/skipped pending rows
    const updatedRows = (state.gmailSyncResult?.rows || []).map(r => {
      if (r.status !== 'pending') return r;
      const wasImported = checks[r.idx]?.checked;
      return { ...r, status: wasImported ? 'imported' : 'skipped_by_user' };
    });
    state.gmailSyncResult = {
      checked: state.gmailSyncResult?.checked || 0,
      imported: count,
      rows: updatedRows,
      error: null
    };
    gistSync();
    closeModal('gmail-preview-modal');
    renderView();
    showToast(`Imported ${count} expense${count !== 1 ? 's' : ''} from Gmail`, 'success');
  });
}

async function gmailDoSync(silent = false) {
  const token = await getGmailToken();
  if (!token) {
    state.gmailSyncResult = { error: 'Token expired — please tap Reconnect Gmail' };
    if (!silent) { await db.setSetting('gmail_token', null); renderView(); }
    return;
  }

  const syncBtns = [
    document.getElementById('gmail-sync-btn'),
    document.getElementById('dash-gmail-sync-btn'),
    document.getElementById('header-gmail-sync-btn'),
    document.getElementById('sidebar-sync-gmail-btn')
  ].filter(Boolean);

  if (!silent) {
    syncBtns.forEach(b => {
      b.disabled = true;
      if (b.id === 'header-gmail-sync-btn' || b.id === 'sidebar-sync-gmail-btn') {
        b.style.opacity = '0.6';
      } else {
        b.textContent = '⏳ Syncing…';
      }
    });
  }

  try {
    // Always scan from start date — never use last-sync as floor
    const startDate = await db.getSetting('gmail_start_date', '2026-10-07');
    const geminiApiKey = await db.getSetting('gemini_api_key', '');
    await db.setSetting('gmail_last_sync', null); // clear stale value so it never interferes
    const afterStr = startDate.replace(/-/g, '/');
    const query = `{from:hdfc from:sbi from:sbicard from:icici from:unionbank from:slice from:axis from:kotak debited spent deducted "debit alert" "transaction alert" "paid to" "transferred to" credited refund cashback} after:${afterStr}`;

    // Fetch all pages
    const allMessages = [];
    let pageToken = null;
    do {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        await db.setSetting('gmail_token', null);
        state.gmailSyncResult = { error: 'Token expired — please tap Reconnect Gmail' };
        if (!silent) renderView();
        return;
      }
      if (!res.ok) {
        state.gmailSyncResult = { error: `Gmail API error ${res.status}` };
        if (!silent) renderView();
        return;
      }
      const data = await res.json();
      allMessages.push(...(data.messages || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    // Duplicate key = refNo if present, else "msg:{gmailMsgId}"
    const importedRefs = await db.getSetting('gmail_imported_refs', []);
    const importedSet = new Set(importedRefs);

    const rows = [];      // per-email result rows for display
    const toImport = [];  // new transactions to show in preview

    for (const msg of allMessages) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) continue;
      const msgData = await msgRes.json();

      const headers = msgData.payload?.headers || [];
      const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
      const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
      const subject = subjectHeader?.value || '(no subject)';
      const from = fromHeader?.value || '';
      const emailDate = parseInt(msgData.internalDate || Date.now(), 10);
      const dateStr = normalizeDate(null, emailDate);

      const text = extractEmailText(msgData.payload || {});
      const emailBank = detectBank(from, subject, text);

      const result = await parseBankEmail(text, emailDate, subject, from, geminiApiKey);

      if (!result) {
        rows.push({ date: dateStr, subject, status: 'failed', snippet: text.slice(0, 150), bank: emailBank });
        continue;
      }

      // Skip before start date
      if (result.date < startDate) {
        rows.push({ date: dateStr, subject, status: 'before_start', bank: result.bank });
        continue;
      }

      // Duplicate key: refNo preferred, else Gmail message ID
      const dupeKey = result.refNo ? result.refNo : `msg:${msg.id}`;
      result._dupeKey = dupeKey;

      if (importedSet.has(dupeKey) || (result.refNo && importedSet.has(result.refNo))) {
        rows.push({ date: result.date, time: result.time || '', subject, status: 'dupe', bank: result.bank });
        continue;
      }

      const { categoryId } = await autoCategory(result.merchant);
      result.category = categoryId;
      toImport.push(result);
      rows.push({
        date: result.date,
        time: result.time || '',
        subject,
        status: 'pending',
        type: result.type,
        amount: result.amount,
        merchant: result.merchant,
        bank: result.bank,
        idx: toImport.length - 1
      });
    }

    state.gmailSyncResult = {
      checked: allMessages.length,
      imported: 0,
      rows,
      error: null
    };

    if (toImport.length === 0) {
      if (!silent) {
        renderView();
        showToast(`Checked ${allMessages.length} emails. No new transactions found.`);
      }
      return;
    }

    state.gmailPendingImport = toImport;
    showGmailPreview(toImport, importedRefs);

  } catch (err) {
    state.gmailSyncResult = { error: err.message };
    if (!silent) showToast('Gmail sync failed: ' + err.message, 'error');
  } finally {
    if (!silent) {
      syncBtns.forEach(b => {
        b.disabled = false;
        b.style.opacity = '';
        if (b.id === 'header-gmail-sync-btn' || b.id === 'sidebar-sync-gmail-btn') {
          // Keep structure intact
        } else {
          b.textContent = '🔄 Sync Gmail';
        }
      });
    }
  }
}

async function gmailSyncClick() { return gmailDoSync(false); }

// ─── Data Bootstrap ───────────────────────────────────────────────────────────
async function bootstrap() {
  const cats = await db.getAll('categories');
  if (cats.length === 0) {
    for (const c of DEFAULT_CATEGORIES) await db.put('categories', c);
  } else {
    // Migrate colors for default categories to keep them up-to-date
    for (const def of DEFAULT_CATEGORIES) {
      const existing = cats.find(c => c.id === def.id);
      if (existing && existing.color !== def.color) {
        await db.put('categories', { ...existing, color: def.color });
      }
    }
  }
  const rules = await db.getAll('merchant_rules');
  if (rules.length === 0) {
    for (const r of DEFAULT_MERCHANT_RULES) await db.add('merchant_rules', r);
  }
  state.categories = await db.getAll('categories');
  state.merchantRules = await db.getAll('merchant_rules');

  // Reconcile gatekeeper items across storage layers and update badge
  try {
    await getGatekeeperItems();
    updateGatekeeperBadge();
  } catch (_) {}

  // Smart active month selection:
  // If current month has 0 transactions but an earlier/later month has transactions,
  // open to the latest month that actually has data!
  const allExpenses = await db.getAll('expenses');
  const thisMonthStr = today().slice(0, 7);
  if (allExpenses.length > 0) {
    const hasThisMonth = allExpenses.some(e => (e.month || e.date?.slice(0, 7)) === thisMonthStr);
    if (hasThisMonth) {
      state.currentMonth = thisMonthStr;
    } else {
      const sorted = [...allExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const latestMonth = sorted[0].month || sorted[0].date?.slice(0, 7);
      state.currentMonth = latestMonth || thisMonthStr;
    }
  } else {
    state.currentMonth = thisMonthStr;
  }
}

// ─── Demo Data ────────────────────────────────────────────────────────────────
async function loadDemoData() {
  const now = new Date();
  const y = now.getFullYear(), mo = now.getMonth();
  const curYm = `${y}-${String(mo + 1).padStart(2, '0')}`;
  const prevY = mo === 0 ? y - 1 : y;
  const prevMo = mo === 0 ? 12 : mo;
  const prevYm = `${prevY}-${String(prevMo).padStart(2, '0')}`;

  const demo = [
    // Current Month Income (Credits)
    { amount: 75000, category: 'other', merchant: 'Acme Corp', note: 'Monthly Salary', method: 'Transfer', type: 'credit', date: `${curYm}-01` },
    { amount: 12500, category: 'other', merchant: 'Client Consultancy', note: 'Project milestone', method: 'UPI', type: 'credit', date: `${curYm}-10` },

    // Current Month Expenses (Debits)
    { amount: 18000, category: 'rent', merchant: 'Prestige Apartments', note: 'House Rent', method: 'Transfer', type: 'debit', date: `${curYm}-02` },
    { amount: 4800, category: 'groceries', merchant: 'Nature Basket', note: 'Monthly groceries', method: 'Card', type: 'debit', date: `${curYm}-04` },
    { amount: 650, category: 'food', merchant: 'Swiggy', note: 'Dinner', method: 'UPI', type: 'debit', date: `${curYm}-06` },
    { amount: 350, category: 'transport', merchant: 'Uber', note: 'Office cab', method: 'UPI', type: 'debit', date: `${curYm}-08` },
    { amount: 3499, category: 'shopping', merchant: 'Amazon', note: 'Wireless headphones', method: 'Card', type: 'debit', date: `${curYm}-11` },
    { amount: 1199, category: 'bills', merchant: 'Airtel Broadband', note: 'Fibre bill', method: 'UPI', type: 'debit', date: `${curYm}-13` },
    { amount: 649, category: 'entertainment', merchant: 'Netflix', note: 'Subscription', method: 'Card', type: 'debit', date: `${curYm}-14` },
    { amount: 420, category: 'food', merchant: 'Zomato', note: 'Lunch', method: 'UPI', type: 'debit', date: `${curYm}-15` },

    // Previous Month Income
    { amount: 75000, category: 'other', merchant: 'Acme Corp', note: 'Monthly Salary', method: 'Transfer', type: 'credit', date: `${prevYm}-01` },

    // Previous Month Expenses
    { amount: 18000, category: 'rent', merchant: 'Prestige Apartments', note: '', method: 'Transfer', type: 'debit', date: `${prevYm}-02` },
    { amount: 5200, category: 'groceries', merchant: 'DMart', note: '', method: 'Cash', type: 'debit', date: `${prevYm}-05` },
    { amount: 1400, category: 'food', merchant: 'Swiggy', note: '', method: 'UPI', type: 'debit', date: `${prevYm}-12` },
    { amount: 850, category: 'transport', merchant: 'Ola', note: '', method: 'UPI', type: 'debit', date: `${prevYm}-18` },
  ];

  for (const e of demo) {
    e.month = dateToMonth(e.date);
    e.createdAt = Date.now();
    await db.add('expenses', e);
  }

  // Sample budgets
  const budgets = [
    { id: `food-${curYm}`, categoryId: 'food', month: curYm, amount: 8000 },
    { id: `groceries-${curYm}`, categoryId: 'groceries', month: curYm, amount: 10000 },
    { id: `rent-${curYm}`, categoryId: 'rent', month: curYm, amount: 20000 },
    { id: `transport-${curYm}`, categoryId: 'transport', month: curYm, amount: 3000 },
    { id: `shopping-${curYm}`, categoryId: 'shopping', month: curYm, amount: 5000 },
  ];
  for (const b of budgets) await db.put('budgets', b);

  // Note: Gatekeeper items are strictly user-recorded only. Never seed sample impulse buys.
  updateGatekeeperBadge();

  await db.setSetting('demo_loaded', true);
  state.currentMonth = curYm;
  showToast('Sample data loaded successfully!');
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

  // Ensure any sample impulse buys are completely cleaned up
  try {
    await getGatekeeperItems();
    updateGatekeeperBadge();
  } catch (_) {}
  updateGatekeeperBadge();

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
function updateHeaderState() {
  const titleEl = document.getElementById('header-view-title');
  if (titleEl) {
    const map = {
      dashboard: 'Dashboard',
      transactions: 'Transactions',
      budgets: 'Budgets',
      cards: 'Credit Card',
      settings: 'Settings',
      gatekeeper: 'Purchase Gatekeeper'
    };
    titleEl.textContent = map[state.view] || 'Dashboard';
  }
  const appBreadcrumb = document.querySelector('.breadcrumb-app');
  if (appBreadcrumb) {
    if (state.view === 'cards') {
      appBreadcrumb.textContent = 'Credit Card';
    } else if (state.view === 'gatekeeper') {
      appBreadcrumb.textContent = 'Gatekeeper';
    } else {
      appBreadcrumb.textContent = 'Expenses';
    }
  }
  const monthEl = document.getElementById('header-month-label');
  if (monthEl && state.currentMonth) {
    monthEl.textContent = monthLabel(state.currentMonth);
  }
  const todayBtn = document.getElementById('header-today-btn');
  if (todayBtn) {
    todayBtn.style.display = state.currentMonth === today().slice(0, 7) ? 'none' : 'inline-block';
  }
}

function setView(v) {
  state.view = v;
  playNav();
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === v);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === v);
  });
  // Auto-close mobile slide-over drawer
  document.getElementById('app-sidebar')?.classList.remove('drawer-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('active');
  renderView();
}

async function renderView() {
  const main = document.getElementById('main-content');
  if (!main) return;
  updateHeaderState();
  const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (_particlesRAF) { cancelAnimationFrame(_particlesRAF); _particlesRAF = null; }

  if (!noMotion && window.gsap) {
    window.gsap.to(main, { opacity: 0, y: -10, duration: 0.12, ease: 'power2.in' });
    await new Promise(r => setTimeout(r, 130));
  } else {
    main.style.opacity = '0';
  }

  try {
    state.categories = await db.getAll('categories');
    if (state.view !== 'dashboard') {
      if (state.chart && typeof state.chart.destroy === 'function') {
        try { state.chart.destroy(); } catch (_) {}
        state.chart = null;
      }
      if (state.barChart && typeof state.barChart.destroy === 'function') {
        try { state.barChart.destroy(); } catch (_) {}
        state.barChart = null;
      }
    }
    initGatekeeper({
      categories: state.categories,
      showToast,
      openModal,
      closeModal,
      fmt,
      today,
      renderView,
      gistSync
    });

    switch (state.view) {
      case 'dashboard':    main.innerHTML = await renderDashboard(); await mountDashboard(); break;
      case 'add':          main.innerHTML = renderAddForm(); mountAddForm(); break;
      case 'transactions': main.innerHTML = await renderTransactions(); mountTransactions(); break;
      case 'budgets':      main.innerHTML = await renderBudgets(); mountBudgets(); break;
      case 'cards':        main.innerHTML = await renderCreditCards(); mountCreditCards(); break;
      case 'settings':     main.innerHTML = await renderSettings(); mountSettings(); break;
      case 'gatekeeper':   main.innerHTML = await renderGatekeeper(); mountGatekeeper(); break;
    }
  } catch (err) {
    console.error('renderView error:', err);
    main.innerHTML = `<div class="empty-state" style="padding-top:80px"><div style="font-size:36px;margin-bottom:12px">⚠️</div><div>${err.message}</div></div>`;
  }

  if (!noMotion && window.gsap) {
    window.gsap.fromTo(main, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' });
  } else {
    main.style.opacity = '1';
    main.style.transform = '';
  }

  revealCards();
  
}

// ─── Animation helpers ────────────────────────────────────────────────────────
function revealCards() {
  const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = document.querySelectorAll('#main-content .card');
  if (!cards.length) return;
  if (noMotion || !window.gsap) {
    cards.forEach(c => { c.style.opacity = '1'; c.style.transform = 'none'; });
    return;
  }
  cards.forEach(c => { c.style.opacity = '0'; c.style.transform = 'translateY(24px)'; });
  const obs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = [...cards].indexOf(entry.target);
      window.gsap.to(entry.target, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', delay: idx * 0.07 });
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.05 });
  cards.forEach(c => obs.observe(c));
}

function initCardTilt() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.gsap || !window.matchMedia('(pointer: fine)').matches) return;
  document.querySelectorAll('#main-content .card').forEach(card => {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      window.gsap.to(card, { rotateX: -dy * 6, rotateY: dx * 6, duration: 0.2, ease: 'power2.out', transformPerspective: 1000 });
    });
    card.addEventListener('pointerleave', () => {
      window.gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.5, ease: 'elastic.out(1,0.5)' });
    });
  });
}

function animateCountup(el, target) {
  if (!el || !window.gsap || target <= 0) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const obj = { val: 0 };
  window.gsap.to(obj, {
    val: target, duration: 0.8, ease: 'power2.out',
    onUpdate() { el.textContent = '₹' + Math.round(obj.val).toLocaleString('en-IN'); },
  });
}

function triggerAddBurst(btn) {
  if (!btn || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('span');
    el.className = 'add-burst-particle';
    el.textContent = '₹';
    el.style.cssText = `left:${cx}px;top:${cy}px;`;
    document.body.appendChild(el);
    const angle = (i / 6) * Math.PI * 2;
    const dist = 60 + Math.random() * 40;
    el.animate([
      { transform: `translate(-50%,-50%) translate(0,0) scale(0)`, opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${Math.cos(angle)*dist}px,${Math.sin(angle)*dist}px) scale(1.4)`, opacity: 0 },
    ], { duration: 600, easing: 'cubic-bezier(0,0.9,0.57,1)', fill: 'forwards' })
      .finished.then(() => el.remove());
  }
}

function initCustomCursor() {
  // Using native OS cursor for optimal accessibility, precision, and performance
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const month = state.currentMonth;
  const [y, m] = month.split('-').map(Number);
  const prevMonth = m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`;

  const allExpenses = await db.getAll('expenses');
  const expenses = allExpenses.filter(e => (e.month || e.date?.slice(0, 7)) === month);
  const prevExpenses = allExpenses.filter(e => (e.month || e.date?.slice(0, 7)) === prevMonth);


  // Fetch budgets to set Total Income as Total Budgeted Amount (fallback to credits if none exist)
  const allBudgets = await db.getAll('budgets');
  const monthBudgets = getBudgetsForMonth(allBudgets, month);
  const totalBudgeted = monthBudgets.reduce((s, b) => s + b.amount, 0);

  // Separate Income (Credit), Living Expenses (Debit excluding Savings), and Savings (Debit in Savings category)
  const incomeExpenses = expenses.filter(e => e.type === 'credit');
  const creditIncomeTotal = incomeExpenses.reduce((s, e) => s + e.amount, 0);
  const savingsExpenses = expenses.filter(e => e.type !== 'credit' && isSavingsCategory(e.category));
  const debitExpenses = expenses.filter(e => e.type !== 'credit' && !isSavingsCategory(e.category));

  // User requirement: set total income as total budgeted amount
  const isBudgetedIncome = totalBudgeted > 0;
  const incomeTotal = isBudgetedIncome ? totalBudgeted : creditIncomeTotal;
  const savingsTotal = savingsExpenses.reduce((s, e) => s + e.amount, 0);
  const expenseTotal = debitExpenses.reduce((s, e) => s + e.amount, 0);
  const netBalance = incomeTotal - expenseTotal;

  // Previous month comparison (using prev total budgeted if available, else credit income)
  const prevMonthBudgets = getBudgetsForMonth(allBudgets, prevMonth);
  const prevTotalBudgeted = prevMonthBudgets.reduce((s, b) => s + b.amount, 0);
  const prevCreditIncome = prevExpenses.filter(e => e.type === 'credit').reduce((s, e) => s + e.amount, 0);
  const prevIncomeTotal = prevTotalBudgeted > 0 ? prevTotalBudgeted : prevCreditIncome;
  const prevExpenseTotal = prevExpenses.filter(e => e.type !== 'credit' && !isSavingsCategory(e.category)).reduce((s, e) => s + e.amount, 0);
  const expenseDiff = expenseTotal - prevExpenseTotal;
  const diffPct = prevExpenseTotal > 0 ? ((expenseDiff / prevExpenseTotal) * 100).toFixed(0) : '';

  // Savings rate calculation linked to tracked savings vs total budgeted income
  const savingsRate = incomeTotal > 0
    ? ((savingsTotal / incomeTotal) * 100).toFixed(1)
    : (savingsTotal > 0 ? '100.0' : '0.0');

  // Category breakdown for living expenses (excluding savings)
  const byCat = {};
  for (const e of debitExpenses) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }

  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const daysCurrent = Math.max(1, new Date().getDate());
  const avgDaily = expenseTotal / daysCurrent;

  const topCatEntry = catEntries[0];
  const topCat = topCatEntry ? getCat(topCatEntry[0]) : null;
  const topCatPct = (topCatEntry && expenseTotal > 0) ? ((topCatEntry[1] / expenseTotal) * 100).toFixed(1) : 0;

  const catLegendRows = catEntries.map(([id, amt]) => {
    const cat = getCat(id);
    const pct = expenseTotal > 0 ? ((amt / expenseTotal) * 100).toFixed(1) : '0';
    const catTxns = debitExpenses.filter(e => e.category === id);
    const catBudget = monthBudgets.find(b => b.category === id)?.amount || 0;

    let budgetInfoHtml = '';
    if (catBudget > 0) {
      const remaining = catBudget - amt;
      if (remaining < 0) {
        budgetInfoHtml = `<span class="cat-sub-budget cat-budget-over">⚠️ Over by ${fmtCurrency(Math.abs(remaining), true)}</span>`;
      } else if (remaining === 0) {
        budgetInfoHtml = `<span class="cat-sub-budget cat-budget-ok">100% of ${fmtCurrency(catBudget, true)} budget</span>`;
      } else {
        budgetInfoHtml = `<span class="cat-sub-budget cat-budget-ok">${fmtCurrency(remaining, true)} left</span>`;
      }
    }

    return `
      <div class="cat-breakdown-row" data-cat="${id}" role="button" tabindex="0" title="Click to view all ${catTxns.length} ${cat.name} transactions">
        <div class="cat-row-top">
          <div class="cat-row-left">
            <span class="cat-dot" style="background:${cat.color}"></span>
            <span class="cat-icon-badge">${getCatBadge(cat, 15)}</span>
            <span class="cat-name-text">${cat.name}</span>
          </div>
          <div class="cat-row-right">
            <span class="cat-amt-text">${fmtCurrency(amt, false)}</span>
            <span class="cat-pct-pill">${pct}%</span>
          </div>
        </div>
        <div class="cat-progress-track">
          <div class="cat-progress-fill" style="width:${pct}%;background:${cat.color}"></div>
        </div>
        <div class="cat-row-sub">
          <span class="cat-sub-txns">${catTxns.length} txn${catTxns.length !== 1 ? 's' : ''}</span>
          ${budgetInfoHtml}
        </div>
      </div>
    `;
  }).join('');

  // Find latest month with data if this month is empty
  let otherMonthBanner = '';
  if (expenses.length === 0 && allExpenses.length > 0) {
    const sorted = [...allExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const latestAvailableMonth = sorted[0].month || sorted[0].date?.slice(0, 7);
    const countInLatest = allExpenses.filter(e => (e.month || e.date?.slice(0, 7)) === latestAvailableMonth).length;
    otherMonthBanner = `
      <div class="dashboard-card" style="margin-bottom:20px;padding:22px 20px;border-left:4px solid var(--brand);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px">
        <div>
          <div style="font-weight:700;font-size:15px;color:var(--text);margin-bottom:3px">No transactions recorded for ${monthLabel(month)}</div>
          <div style="font-size:12.5px;color:var(--text3)">You have ${countInLatest} transaction${countInLatest !== 1 ? 's' : ''} in <strong>${monthLabel(latestAvailableMonth)}</strong>.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" id="btn-jump-to-data-month" data-month="${latestAvailableMonth}">View ${monthLabel(latestAvailableMonth)} →</button>
          <button class="btn-secondary" id="btn-add-this-month">+ Add in ${monthLabel(month)}</button>
        </div>
      </div>
    `;
  }

  // Welcome banner if whole database is completely empty
  let emptyDbBanner = '';
  if (allExpenses.length === 0) {
    emptyDbBanner = `
      <div class="dashboard-card" style="margin-bottom:20px;text-align:center;padding:36px 20px">
        <div style="font-size:42px;margin-bottom:12px">💳</div>
        <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:6px">Welcome to Expenses</div>
        <p style="color:var(--text3);font-size:13.5px;max-width:480px;margin:0 auto 20px;line-height:1.5">
          Your personal finance dashboard is ready. Add your first transaction, parse a bank alert SMS/email, or load sample data to explore charts and insights.
        </p>
        <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
          <button class="btn-primary" id="btn-empty-add-txn">+ Add Transaction</button>
          <button class="btn-secondary" id="btn-empty-import">📥 Import Bank Alerts</button>
          <button class="btn-secondary" id="btn-empty-load-demo">✨ Load Sample Data</button>
        </div>
      </div>
    `;
  }


  let storageBannerMsg = null;
  if (isRunningInSafariInsteadOfPWA()) {
    storageBannerMsg = `<strong>You're in Safari, not the installed app.</strong>
      Expenses you add here won't appear in your Home Screen app. Open from your Home Screen icon instead.`;
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
  ${emptyDbBanner}
  ${otherMonthBanner}

  <!-- Top 4-Card KPI Summary Grid (Linear / Monarch Style) -->
  <div class="kpi-grid">
    <!-- 1. Net Balance -->
    <div class="kpi-card kpi-net">
      <div class="kpi-card-header">
        <span class="kpi-title">Net Balance</span>
        <div class="kpi-icon-wrap" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
          </svg>
        </div>
      </div>
      <div class="kpi-val" style="color:${netBalance >= 0 ? 'var(--income)' : 'var(--expense)'}">
        ${fmtCurrency(netBalance, true)}
      </div>
      <div class="kpi-footer">
        <span class="kpi-badge ${netBalance >= 0 ? 'positive' : 'negative'}">${netBalance >= 0 ? 'Surplus' : 'Deficit'}</span>
        <span>${isBudgetedIncome ? (savingsTotal > 0 ? `${fmtCurrency(savingsTotal, true)} saved · ${fmtCurrency(incomeTotal - expenseTotal - savingsTotal, true)} unallocated` : `${fmtCurrency(netBalance, true)} unspent`) : (expenses.length === 0 ? 'No activity this month' : (savingsTotal > 0 ? `${fmtCurrency(savingsTotal, true)} saved · ${fmtCurrency(incomeTotal - expenseTotal - savingsTotal, true)} cash left` : (netBalance >= 0 ? 'Cash flow positive' : 'Expenses exceed income')))}</span>
      </div>
    </div>

    <!-- 2. Total Income (This Month) -->
    <div class="kpi-card kpi-income">
      <div class="kpi-card-header">
        <span class="kpi-title">Total Income</span>
        <div class="kpi-icon-wrap" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="17" x2="17" y2="7"/>
            <polyline points="7 7 17 7 17 17"/>
          </svg>
        </div>
      </div>
      <div class="kpi-val">${fmtCurrency(incomeTotal, true)}</div>
      <div class="kpi-footer">
        <span class="kpi-badge positive">●</span>
        <span>${isBudgetedIncome ? `Total budgeted (${monthBudgets.length} categor${monthBudgets.length !== 1 ? 'ies' : 'y'})` : `${incomeExpenses.length} credit${incomeExpenses.length !== 1 ? 's' : ''} in ${monthLabel(month)}`}</span>
      </div>
    </div>

    <!-- 3. Total Expenses (This Month) -->
    <div class="kpi-card kpi-expense">
      <div class="kpi-card-header">
        <span class="kpi-title">Total Expenses</span>
        <div class="kpi-icon-wrap" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="7" x2="17" y2="17"/>
            <polyline points="17 7 17 17 7 17"/>
          </svg>
        </div>
      </div>
      <div class="kpi-val">${fmtCurrency(expenseTotal, true)}</div>
      <div class="kpi-footer">
        ${diffPct ? `<span class="kpi-badge ${expenseDiff <= 0 ? 'positive' : 'negative'}">${expenseDiff <= 0 ? '▼' : '▲'} ${Math.abs(diffPct)}% vs prev</span>` : '<span class="kpi-badge neutral">●</span>'}
        <span>${debitExpenses.length} living expense${debitExpenses.length !== 1 ? 's' : ''}</span>
      </div>
    </div>

    <!-- 4. Savings Rate (%) -->
    <div class="kpi-card kpi-savings">
      <div class="kpi-card-header">
        <span class="kpi-title">Savings Rate</span>
        <div class="kpi-icon-wrap" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 3h12l4 6-10 12L2 9z"/>
            <path d="M2 9h20"/>
          </svg>
        </div>
      </div>
      <div class="kpi-val">${incomeTotal > 0 ? `${savingsRate}%` : (savingsTotal > 0 ? fmtCurrency(savingsTotal, true) : '0.0%')}</div>
      <div class="kpi-footer">
        <span class="kpi-badge ${parseFloat(savingsRate) >= 20 ? 'positive' : (savingsTotal > 0 ? 'positive' : 'neutral')}">●</span>
        <span>${savingsTotal > 0 ? `${fmtCurrency(savingsTotal, true)} saved${incomeTotal > 0 ? ` (${savingsRate}% of ${isBudgetedIncome ? 'budget' : 'income'})` : ''}` : (incomeTotal > 0 ? 'No savings tracked' : 'Track via Savings category')}</span>
      </div>
    </div>
  </div>

  <!-- Interactive Charts & Analytics Grid -->
  <div class="analytics-grid">
    <!-- Category Breakdown Card (Full Width Hero Analytics) -->
    <div class="dashboard-card category-breakdown-card">
      <div class="card-header-row">
        <div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="card-heading" style="font-size:17px">Category Breakdown</span>
            ${catEntries.length > 0 ? `
              <span class="cat-count-badge">${catEntries.length} Categories</span>
            ` : ''}
          </div>
          <div class="card-subheading">${monthLabel(month)} Spending Distribution &amp; Budget Health</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn-secondary-sm" id="dash-view-budgets-link" style="font-size:12px;font-weight:600">Budgets 🎯</button>
          <button class="btn-primary-sm" id="dash-view-all-txns-link" style="font-size:12px;font-weight:600">All Transactions →</button>
        </div>
      </div>

      ${debitExpenses.length === 0 ? `
        <div class="empty-state" style="padding:48px 0">
          <div class="empty-icon">📊</div>
          <div class="empty-title">No expenses in ${monthLabel(month)}</div>
          <div class="empty-sub">Tap "+ Add Transaction" or import bank emails to begin</div>
        </div>
      ` : `
        <div class="donut-layout">
          <div class="donut-chart-section">
            <div class="donut-canvas-wrap">
              <canvas id="donutChart"></canvas>
              <div class="donut-center-overlay">
                <span class="donut-center-label">Total Spend</span>
                <span class="donut-center-amount">${fmtCurrency(expenseTotal, false)}</span>
                <span class="donut-center-count">${catEntries.length} Categories · ${debitExpenses.length} Txns</span>
              </div>
            </div>
            ${topCat ? `
              <div class="donut-quick-metrics">
                <div class="donut-metric-chip" title="Category with highest spending this month">
                  <span class="donut-metric-lbl">Highest Spend</span>
                  <span class="donut-metric-val">${topCat.emoji || '🏷️'} ${topCat.name} (${topCatPct}%)</span>
                </div>
                <div class="donut-metric-chip" title="Average living expense per day in ${monthLabel(month)}">
                  <span class="donut-metric-lbl">Daily Average</span>
                  <span class="donut-metric-val">${fmtCurrency(avgDaily, true)}</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="donut-legend-wrap" id="donut-legend-wrap">
            ${catLegendRows}
          </div>
        </div>
      `}
    </div>
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
  const allExpenses = await db.getAll('expenses');
  const expenses = allExpenses.filter(e => (e.month || e.date?.slice(0, 7)) === month);

  document.getElementById('dismiss-storage-banner')?.addEventListener('click', () => {
    document.getElementById('storage-banner')?.remove();
    state.storagePersisted = true;
  });

  // Render Charts
  renderDonutChart(expenses);

  // Empty state actions
  document.getElementById('btn-empty-add-txn')?.addEventListener('click', () => openAddModal());
  document.getElementById('btn-empty-import')?.addEventListener('click', () => openImportModal());
  document.getElementById('btn-empty-load-demo')?.addEventListener('click', async () => {
    await loadDemoData();
  });

  // Jump to latest month button
  document.getElementById('btn-jump-to-data-month')?.addEventListener('click', e => {
    const targetMonth = e.currentTarget.dataset.month;
    if (targetMonth) {
      state.currentMonth = targetMonth;
      renderView();
    }
  });
  document.getElementById('btn-add-this-month')?.addEventListener('click', () => openAddModal());

  // Category breakdown click -> view transactions in category
  document.getElementById('dash-view-all-txns-link')?.addEventListener('click', () => setView('transactions'));
  document.getElementById('dash-view-budgets-link')?.addEventListener('click', () => setView('budgets'));

  document.querySelectorAll('.cat-breakdown-row').forEach(el => {
    const handleCategoryClick = async () => {
      const catId = el.dataset.cat;
      const cat = getCat(catId);
      const catExps = expenses.filter(e => e.category === catId).sort((a,b) => (b.date || '').localeCompare(a.date || ''));
      const total = catExps.reduce((s, e) => s + e.amount, 0);
      document.getElementById('cat-modal-content').innerHTML = `
        <div class="modal-title" style="display:flex;align-items:center;gap:8px">${getCatBadge(cat, 18)} <span>${cat.name}</span> — <span>${fmtCurrency(total)}</span></div>
        <div class="exp-list" style="margin-top:14px">
          ${catExps.length === 0 ? '<div class="empty-state">No expenses</div>' :
            catExps.map(e => `
              <div class="exp-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
                <div class="exp-row-left">
                  <div style="font-weight:600">${e.merchant || cat.name}</div>
                  <div style="font-size:11.5px;color:var(--text3)">${e.date}${e.note ? ' · ' + e.note : ''} · ${e.method || 'UPI'}</div>
                </div>
                <div style="font-weight:700">${fmtCurrency(e.amount)}</div>
              </div>
            `).join('')
          }
        </div>
      `;
      openModal('cat-modal');
    };

    el.addEventListener('click', handleCategoryClick);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleCategoryClick();
      }
    });
  });

  document.getElementById('cat-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('cat-modal');
  });
}

function renderDonutChart(expenses) {
  const canvas = document.getElementById('donutChart');
  if (!canvas || !window.Chart) return;
  if (state.chart && typeof state.chart.destroy === 'function') {
    try { state.chart.destroy(); } catch (_) {}
    state.chart = null;
  }

  const debitExpenses = expenses.filter(e => e.type !== 'credit' && !isSavingsCategory(e.category));
  const byCat = {};
  for (const e of debitExpenses) {
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  try {
    state.chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: entries.map(([id]) => getCat(id).name),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([id]) => getCat(id).color),
          borderWidth: 2,
          borderColor: isDark ? '#1E191B' : '#ffffff',
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '74%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(30, 25, 27, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            titleColor: isDark ? '#F5EFEA' : '#141112',
            bodyColor: isDark ? '#D8CECA' : '#4A4042',
            padding: 12,
            cornerRadius: 10,
            borderColor: isDark ? 'rgba(223, 196, 152, 0.25)' : 'rgba(217, 155, 132, 0.25)',
            borderWidth: 1,
            callbacks: {
              label: ctx => {
                const val = ctx.raw || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                return ` ${fmtCurrency(val, true)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  } catch (err) {
    console.warn('Donut chart render error:', err);
  }
}

function renderCashFlowChart(expenses, month) {
  const canvas = document.getElementById('cashFlowChart');
  if (!canvas || !window.Chart) return;
  if (state.barChart && typeof state.barChart.destroy === 'function') {
    try { state.barChart.destroy(); } catch (_) {}
    state.barChart = null;
  }

  const days = daysInMonth(month);
  const incomeByDay = Array(days).fill(0);
  const expenseByDay = Array(days).fill(0);

  for (const e of expenses) {
    const d = parseInt((e.date || '').slice(8, 10), 10) - 1;
    if (d >= 0 && d < days) {
      if (e.type === 'credit') {
        incomeByDay[d] += e.amount;
      } else if (!isSavingsCategory(e.category)) {
        expenseByDay[d] += e.amount;
      }
    }
  }

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(232, 207, 193, 0.06)' : 'rgba(0,0,0,0.05)';
  const textColor = isDark ? '#A89B95' : '#7D7073';

  try {
    state.barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: Array.from({ length: days }, (_, i) => i + 1),
        datasets: [
          {
            label: 'Income',
            data: incomeByDay,
            backgroundColor: 'rgba(127, 176, 147, 0.85)',
            borderColor: '#7FB093',
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.8,
            categoryPercentage: 0.85,
          },
          {
            label: 'Expenses',
            data: expenseByDay,
            backgroundColor: 'rgba(217, 155, 132, 0.85)',
            borderColor: '#D99B84',
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.8,
            categoryPercentage: 0.85,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(30, 25, 27, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            titleColor: isDark ? '#F5EFEA' : '#141112',
            bodyColor: isDark ? '#D8CECA' : '#4A4042',
            borderColor: isDark ? 'rgba(223, 196, 152, 0.25)' : 'rgba(217, 155, 132, 0.25)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw, true)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: textColor, maxTicksLimit: 15, font: { size: 10 } }
          },
          y: {
            grid: { color: gridColor },
            border: { display: false },
            ticks: {
              color: textColor,
              font: { size: 10 },
              callback: v => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
            },
            beginAtZero: true
          }
        }
      }
    });
  } catch (err) {
    console.warn('Cash flow chart render error:', err);
  }
}

// ─── Add Expense Form ─────────────────────────────────────────────────────────
function renderAddForm(editData = null) {
  const e = editData || state.editingExpense || {};
  const isEdit = !!e.id;
  const currentType = e.type || 'debit';
  const methods = ['UPI', 'Card', 'Cash', 'Transfer', 'NetBanking'];

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
    <button class="modal-close-btn" id="close-add-modal" title="Close" type="button">✕</button>
    <h2>${isEdit ? 'Edit Transaction' : 'New Transaction'}</h2>
    ${isEdit ? '<button class="btn-link danger" id="delete-expense">Delete</button>' : ''}
  </div>

  <form id="add-form" autocomplete="off">
    <!-- Direction Segmented Switch (Debit vs Credit) -->
    <div class="segmented-control" id="form-type-toggle">
      <button type="button" class="segmented-btn ${currentType === 'debit' ? 'active' : ''}" data-type="debit">Expense (Debit)</button>
      <button type="button" class="segmented-btn ${currentType === 'credit' ? 'active' : ''}" data-type="credit">Income (Credit)</button>
    </div>

    <div class="amount-input-wrap">
      <span class="currency-sym">₹</span>
      <input type="number" id="f-amount" inputmode="decimal" placeholder="0.00" value="${e.amount || ''}" required step="0.01" min="0.01" class="amount-input">
    </div>

    <div class="quick-amounts">
      <button type="button" class="quick-amt-chip" data-val="50">+₹50</button>
      <button type="button" class="quick-amt-chip" data-val="100">+₹100</button>
      <button type="button" class="quick-amt-chip" data-val="500">+₹500</button>
      <button type="button" class="quick-amt-chip" data-val="1000">+₹1,000</button>
      <button type="button" class="quick-amt-chip" data-val="5000">+₹5,000</button>
    </div>

    <label class="field-label">Category</label>
    <div class="cat-grid" id="cat-grid">${catGrid}</div>

    <div class="form-row">
      <div class="form-group">
        <label class="field-label">Date</label>
        <input type="date" id="f-date" value="${e.date || today()}" class="field-input" required>
      </div>
      <div class="form-group">
        <label class="field-label">Time</label>
        <input type="text" id="f-time" placeholder="e.g. 08:44 PM" value="${e.time || (isEdit ? '' : formatTimeIST(Date.now()))}" class="field-input">
      </div>
    </div>

    <label class="field-label">Payment Method</label>
    <div class="method-group" style="margin-bottom:14px">${methodBtns}</div>

    <!-- Credit Card Selection (shown when Method is Card) -->
    <div id="card-select-group" style="display:${(e.method || 'UPI') === 'Card' ? 'block' : 'none'};margin-bottom:14px">
      <label class="field-label">Charged to Credit Card</label>
      <select id="f-card-id" class="field-input">
        <option value="sbi" ${(!e.cardId || e.cardId === 'sbi' || (e.bank || '').toLowerCase().includes('sbi card') || (e.bank || '').toLowerCase() === 'sbi credit card') ? 'selected' : ''}>SBI Credit Card (Counted in Credit Bill)</option>
        <option value="other" ${(e.cardId === 'other' || e.cardId === 'none' || (e.bank && !e.bank.toLowerCase().includes('sbi'))) ? 'selected' : ''}>Other Card / Slice (Normal Expense, not in Credit Bill)</option>
      </select>
    </div>

    <!-- Account Selection (shown when Method is UPI, Transfer, NetBanking, or Cash) -->
    <div id="account-select-group" style="display:${(e.method || 'UPI') !== 'Card' ? 'block' : 'none'};margin-bottom:14px">
      <label class="field-label" id="account-field-label">${currentType === 'credit' ? 'Deposited Into Account' : 'Paid From Account / Bank'}</label>
      <select id="f-account-id" class="field-input">
        <option value="Slice Savings Account" ${(e.bank || '').toLowerCase().includes('slice savings') || (e.bank || '').toLowerCase().includes('slice account') ? 'selected' : ''}>Slice Savings Account</option>
        <option value="SBI Savings Account" ${(e.bank || '').toLowerCase().includes('sbi savings') || (e.bank || '').toLowerCase().includes('sbi account') ? 'selected' : ''}>SBI Savings Account</option>
        <option value="HDFC Bank" ${(e.bank || '').toLowerCase().includes('hdfc') && !(e.bank || '').toLowerCase().includes('credit') ? 'selected' : ''}>HDFC Bank</option>
        <option value="Cash" ${(e.bank || '').toLowerCase().includes('cash') ? 'selected' : ''}>Cash / Wallet</option>
        <option value="Other Bank" ${(!e.bank || (e.bank !== 'Slice Savings Account' && e.bank !== 'SBI Savings Account' && e.bank !== 'HDFC Bank' && e.bank !== 'Cash')) ? 'selected' : ''}>Other Bank / Account</option>
      </select>
    </div>

    <label class="field-label" id="merchant-field-label">${currentType === 'credit' ? 'Sender / Source' : 'Merchant / Payee'}</label>
    <input type="text" id="f-merchant" placeholder="${currentType === 'credit' ? 'e.g. Salary, Client, Friend, Cashback' : 'e.g. Swiggy, Amazon, Uber, DMart'}" value="${e.merchant || ''}" class="field-input">

    <label class="field-label">Note (optional)</label>
    <input type="text" id="f-note" placeholder="What was this for?" value="${e.note || ''}" class="field-input">

    <button type="submit" class="btn-primary" id="btn-submit-add">${isEdit ? 'Save Changes' : (currentType === 'credit' ? '+ Add Income' : '+ Add Expense')}</button>
    ${isEdit ? '<button type="button" class="btn-secondary" id="cancel-edit" style="margin-top:8px">Cancel</button>' : ''}
  </form>
</div>
`;
}

function mountAddForm(modalMode = false) {
  let selectedType = state.editingExpense?.type || 'debit';
  let selectedCat = state.editingExpense?.category || (selectedType === 'credit' ? 'income' : 'food');
  let selectedMethod = state.editingExpense?.method || 'UPI';

  // Toggle Type (Debit / Credit)
  const toggleBtns = document.querySelectorAll('#form-type-toggle .segmented-btn');
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;

      const submitBtn = document.getElementById('btn-submit-add');
      const merchantLabel = document.getElementById('merchant-field-label');
      const accountLabel = document.getElementById('account-field-label');
      const merchantInput = document.getElementById('f-merchant');

      if (submitBtn) {
        submitBtn.textContent = state.editingExpense?.id
          ? 'Save Changes'
          : (selectedType === 'credit' ? '+ Add Income' : '+ Add Expense');
      }
      if (merchantLabel) {
        merchantLabel.textContent = selectedType === 'credit' ? 'Sender / Source' : 'Merchant / Payee';
      }
      if (accountLabel) {
        accountLabel.textContent = selectedType === 'credit' ? 'Deposited Into Account' : 'Paid From Account / Bank';
      }
      if (merchantInput) {
        merchantInput.placeholder = selectedType === 'credit'
          ? 'e.g. Salary, Client, Friend, Cashback'
          : 'e.g. Swiggy, Amazon, Uber, DMart';
      }
    });
  });

  // Quick amount preset chips
  document.querySelectorAll('.quick-amt-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const amtInput = document.getElementById('f-amount');
      if (!amtInput) return;
      const addVal = parseFloat(chip.dataset.val) || 0;
      const curVal = parseFloat(amtInput.value) || 0;
      amtInput.value = (curVal + addVal).toFixed(curVal % 1 !== 0 ? 2 : 0);
      amtInput.dispatchEvent(new Event('input'));
    });
  });

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
      const cardGroup = document.getElementById('card-select-group');
      const acctGroup = document.getElementById('account-select-group');
      if (cardGroup) {
        cardGroup.style.display = selectedMethod === 'Card' ? 'block' : 'none';
      }
      if (acctGroup) {
        acctGroup.style.display = selectedMethod === 'Card' ? 'none' : 'block';
      }
    });
  });

  // Delete
  document.getElementById('delete-expense')?.addEventListener('click', async () => {
    if (!state.editingExpense?.id) return;
    if (confirm('Delete this transaction?')) {
      const id = state.editingExpense.id;
      const item = await db.get('expenses', id);
      await db.delete('expenses', id);
      gistSync();
      playDelete();
      state.undoItem = item;
      state.editingExpense = null;
      showToast('Deleted transaction', 'success', {
        label: 'Undo',
        onClick: async () => {
          if (state.undoItem) {
            await db.add('expenses', state.undoItem);
            state.undoItem = null;
            showToast('Transaction restored!', 'success');
            renderView();
          }
        }
      });
      if (modalMode) { closeAddModal(); renderView(); } else { setView('transactions'); }
    }
  });

  document.getElementById('cancel-edit')?.addEventListener('click', () => {
    state.editingExpense = null;
    if (modalMode) { closeAddModal(); } else { setView('transactions'); }
  });

  document.getElementById('close-add-modal')?.addEventListener('click', () => {
    state.editingExpense = null;
    if (modalMode) { closeAddModal(); } else { setView('dashboard'); }
  });

  // Form submit
  document.getElementById('add-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseAmount(document.getElementById('f-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

    const merchant = document.getElementById('f-merchant').value.trim();
    const date = document.getElementById('f-date').value;
    const time = document.getElementById('f-time')?.value.trim() || state.editingExpense?.time || '';

    const expense = {
      amount,
      category: selectedCat,
      date,
      time,
      month: dateToMonth(date),
      note: document.getElementById('f-note').value.trim(),
      method: selectedMethod,
      merchant,
      type: selectedType, // 'debit' | 'credit'
      createdAt: state.editingExpense?.createdAt || Date.now(),
    };

    if (selectedMethod === 'Card') {
      const cid = document.getElementById('f-card-id')?.value || 'all';
      expense.cardId = cid;
      if (cid === 'sbi') {
        expense.cardId = 'sbi';
        expense.bank = 'SBI Credit Card';
      } else {
        expense.cardId = null;
        expense.bank = 'Other Card';
      }
    } else {
      expense.cardId = null;
      const acct = document.getElementById('f-account-id')?.value;
      if (acct && acct !== 'Other Bank') {
        expense.bank = acct;
      } else if (selectedMethod === 'Cash') {
        expense.bank = 'Cash';
      }
    }

    if (state.editingExpense?.id) {
      expense.id = state.editingExpense.id;
      await db.put('expenses', expense);
      if (merchant && selectedType !== 'credit') await learnMerchant(merchant, selectedCat);
      gistSync();
      state.editingExpense = null;
      showToast('Transaction updated!');
      if (modalMode) { closeAddModal(); renderView(); } else { setView('transactions'); }
    } else {
      await db.add('expenses', expense);
      if (merchant && selectedType !== 'credit') await learnMerchant(merchant, selectedCat);
      gistSync();
      playAdd();
      triggerAddBurst(document.querySelector('#add-form [type="submit"]'));
      showToast(selectedType === 'credit' ? 'Income added!' : (selectedMethod === 'Card' ? 'Added to Expenses & Credit Card Spendings!' : 'Expense added!'));
      if (modalMode) {
        closeAddModal();
        renderView();
      } else {
        // Reset form
        document.getElementById('f-amount').value = '';
        document.getElementById('f-merchant').value = '';
        document.getElementById('f-note').value = '';
        document.getElementById('f-date').value = today();
        if (document.getElementById('f-time')) document.getElementById('f-time').value = formatTimeIST(Date.now());
        selectedCat = 'food';
        selectedMethod = 'UPI';
        selectedType = 'debit';
        document.querySelectorAll('#form-type-toggle .segmented-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'debit'));
        document.querySelectorAll('.cat-pick').forEach(el => el.classList.toggle('selected', el.dataset.id === 'food'));
        document.querySelectorAll('.method-btn').forEach(el => el.classList.toggle('active', el.dataset.method === 'UPI'));
        document.getElementById('f-amount').focus();
      }
    }
  });

  setTimeout(() => document.getElementById('f-amount')?.focus(), 100);
}

// ─── Transactions ─────────────────────────────────────────────────────────────
async function renderTransactions() {
  let expenses = await db.getAll('expenses');

  // 1. Date Range Filter
  if (state.filterDateRange === 'month') {
    expenses = expenses.filter(e => e.month === state.currentMonth);
  } else if (state.filterDateRange === 'last_month') {
    const [y, m] = state.currentMonth.split('-').map(Number);
    const lm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    expenses = expenses.filter(e => e.month === lm);
  } else if (state.filterDateRange === '30days') {
    const thirtyDaysAgo = Date.now() - 30 * 86400000;
    expenses = expenses.filter(e => new Date(e.date + 'T00:00:00').getTime() >= thirtyDaysAgo);
  }

  // 2. Type Filter (Debit vs Credit vs Card)
  if (state.filterType === 'debit') {
    expenses = expenses.filter(e => e.type !== 'credit');
  } else if (state.filterType === 'credit') {
    expenses = expenses.filter(e => e.type === 'credit');
  } else if (state.filterType === 'card') {
    expenses = expenses.filter(e => isCreditCardExpense(e));
  }

  // 3. Category Filter
  if (state.filterCategory) {
    expenses = expenses.filter(e => e.category === state.filterCategory);
  }

  // 4. Instant Search Filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    expenses = expenses.filter(e =>
      (e.merchant || '').toLowerCase().includes(q) ||
      (e.note || '').toLowerCase().includes(q) ||
      (e.method || '').toLowerCase().includes(q) ||
      getCat(e.category).name.toLowerCase().includes(q) ||
      String(e.amount).includes(q)
    );
  }

  // 5. Sorting
  expenses.sort((a, b) => {
    let av, bv;
    if (state.sortCol === 'date')          { av = `${a.date} ${a.time || '00:00'}`; bv = `${b.date} ${b.time || '00:00'}`; }
    else if (state.sortCol === 'merchant') { av = (a.merchant||'').toLowerCase(); bv = (b.merchant||'').toLowerCase(); }
    else if (state.sortCol === 'category') { av = getCat(a.category).name; bv = getCat(b.category).name; }
    else if (state.sortCol === 'amount')   { av = a.amount; bv = b.amount; }
    else if (state.sortCol === 'method')   { av = a.method||''; bv = b.method||''; }
    else                                   { av = `${a.date} ${a.time || '00:00'}`; bv = `${b.date} ${b.time || '00:00'}`; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return state.sortDir === 'asc' ? cmp : -cmp;
  });

  // Calculate filtered totals
  const totalDebits = expenses.filter(e => e.type !== 'credit').reduce((s, e) => s + e.amount, 0);
  const totalCredits = expenses.filter(e => e.type === 'credit').reduce((s, e) => s + e.amount, 0);

  const catOptions = state.categories.map(c =>
    `<option value="${c.id}" ${state.filterCategory === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`
  ).join('');

  const tableColLabels = { date: 'Date & Time', merchant: 'Merchant / Payee', category: 'Category', method: 'Method', type: 'Type', amount: 'Amount' };
  const tableHeaderCols = ['date', 'merchant', 'category', 'method', 'type', 'amount'].map(col => {
    const active = state.sortCol === col;
    const arrow = active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕';
    return `<th class="txn-th ${active ? 'txn-th-active' : ''} sortable" data-sort="${col}">${tableColLabels[col]}<span class="sort-arrow">${arrow}</span></th>`;
  }).join('') + '<th class="txn-th actions-cell">Actions</th>';

  const tableRows = expenses.length === 0
    ? `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text3)">
        <div class="empty-state" style="padding:20px 0">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">No transactions match your filters</div>
          <div class="empty-sub">Try clearing filters or search terms</div>
          <button class="btn-secondary" id="reset-txn-filters" style="margin-top:12px">Clear All Filters</button>
        </div>
      </td></tr>`
    : expenses.map(e => {
        const cat = getCat(e.category);
        const isCredit = e.type === 'credit';
        const d = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const initial = getMerchantInitial(e.merchant || cat.name);
        const avatarColor = getMerchantColor(e.merchant || cat.name);
        return `
          <tr class="txn-row txn-row-item" data-id="${e.id}">
            <td class="txn-td txn-date" style="white-space:nowrap">
              <div class="txn-date-main">${d}</div>
              ${e.time ? `<div class="txn-time-sub">${e.time}</div>` : ''}
            </td>
            <td class="txn-td txn-merchant">
              <div class="merchant-cell">
                <div class="merchant-avatar" style="background:${avatarColor}">${initial}</div>
                <div class="merchant-meta">
                  <span class="merchant-title">${e.merchant || cat.name}</span>
                  ${e.note ? `<span class="merchant-note">${e.note}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="txn-td">
              <span class="cat-pill" style="background:${cat.color}20;color:${cat.color}">
                ${getCatBadge(cat, 12)} <span>${cat.name}</span>
              </span>
            </td>
            <td class="txn-td">
              <span class="method-tag">${e.method || 'UPI'}</span>
            </td>
            <td class="txn-td">
              <span class="direction-badge direction-${isCredit ? 'credit' : 'debit'}">
                ${isCredit ? 'Credit' : 'Debit'}
              </span>
            </td>
            <td class="txn-td amount-cell ${isCredit ? 'credit' : 'debit'}">
              ${isCredit ? '+' : '-'}${fmtCurrency(e.amount, true)}
            </td>
            <td class="txn-td actions-cell">
              <button class="row-action-btn edit-txn-btn" data-id="${e.id}" title="Edit Transaction" aria-label="Edit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                  <path d="m15 5 4 4"/>
                </svg>
              </button>
              <button class="row-action-btn delete-btn txn-delete-btn" data-id="${e.id}" title="Delete Transaction" aria-label="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');

  return `
<div class="view-transactions">
  <div class="transactions-section">
    <div class="view-header" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div>
        <h2 class="view-title" style="margin-bottom:2px">Transactions</h2>
        <div style="font-size:12.5px;color:var(--text3)">
          Showing <strong>${expenses.length}</strong> records · Spent: <span style="font-weight:700;color:var(--text)">${fmtCurrency(totalDebits)}</span> · Received: <span style="font-weight:700;color:var(--income)">${fmtCurrency(totalCredits)}</span>
        </div>
      </div>
      <div class="view-header-actions" style="display:flex;gap:8px">
        <button class="btn-secondary" id="open-import-btn" title="Import from Bank Emails or CSV">
          <span>📥</span><span>Import</span>
        </button>
        <button class="btn-secondary" id="open-export" title="Export to CSV / PDF">
          <span>📤</span><span>Export</span>
        </button>
        <button class="btn-primary" id="txn-quick-add-btn">
          <span>+ Add</span>
        </button>
      </div>
    </div>

    <!-- Filter & Search Toolbar -->
    <div class="txn-controls-bar">
      <div class="txn-search-wrap">
        <svg class="txn-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="search" id="search-input" placeholder="Search merchant, note, amount..." value="${state.searchQuery}" class="txn-search-input">
        <button type="button" class="txn-search-clear" id="search-clear" style="display:${state.searchQuery ? 'flex' : 'none'}" aria-label="Clear search">✕</button>
      </div>

      <div class="txn-filters-group">
        <!-- Date Range Filter -->
        <select id="range-filter" class="filter-select">
          <option value="month" ${state.filterDateRange === 'month' ? 'selected' : ''}>This Month (${monthLabel(state.currentMonth)})</option>
          <option value="last_month" ${state.filterDateRange === 'last_month' ? 'selected' : ''}>Last Month</option>
          <option value="30days" ${state.filterDateRange === '30days' ? 'selected' : ''}>Last 30 Days</option>
          <option value="all" ${state.filterDateRange === 'all' ? 'selected' : ''}>All Time</option>
        </select>

        <!-- Transaction Type Filter -->
        <select id="type-filter" class="filter-select">
          <option value="all" ${state.filterType === 'all' ? 'selected' : ''}>All Types</option>
          <option value="debit" ${state.filterType === 'debit' ? 'selected' : ''}>Expenses (Debit)</option>
          <option value="credit" ${state.filterType === 'credit' ? 'selected' : ''}>Income (Credit)</option>
          <option value="card" ${state.filterType === 'card' ? 'selected' : ''}>💳 Credit Card Charges</option>
        </select>

        <!-- Category Filter -->
        <select id="cat-filter" class="filter-select">
          <option value="">All Categories</option>
          ${catOptions}
        </select>
      </div>
    </div>

    <!-- Hybrid Table / Scannable List -->
    <div class="txn-list-wrap">
      <table class="txn-hybrid-table">
        <thead>
          <tr>${tableHeaderCols}</tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- Export Modal -->
<div class="modal" id="export-modal">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-title">Export Transactions</div>
    <p class="hint-text">Exports all transactions in the database.</p>
    <button class="export-option-btn" id="export-csv">
      <span class="export-opt-icon">📊</span>
      <div class="export-opt-text">
        <div class="export-opt-title">Spreadsheet (CSV)</div>
        <div class="export-opt-sub">Opens in Excel, Numbers, Google Sheets</div>
      </div>
    </button>
    <button class="export-option-btn" id="export-pdf">
      <span class="export-opt-icon">📄</span>
      <div class="export-opt-text">
        <div class="export-opt-title">PDF / Print Summary</div>
        <div class="export-opt-sub">Save as PDF or print report</div>
      </div>
    </button>
    <button class="btn-secondary" id="cancel-export" style="margin-top:10px">Cancel</button>
  </div>
</div>
`;
}

async function exportCSV() {
  const expenses = await db.getAll('expenses');
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || (b.createdAt || 0) - (a.createdAt || 0));

  const esc = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const rows = [
    ['Date', 'Time', 'Merchant / Payee', 'Category', 'Type', 'Amount', 'Method', 'Note'].map(esc).join(','),
    ...expenses.map(e => {
      const cat = getCat(e.category);
      return [e.date, e.time || '', e.merchant || cat.name, cat.name, e.type || 'debit', e.amount, e.method || '', e.note || ''].map(esc).join(',');
    }),
  ];

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${expenses.length} transactions`);
}

async function exportPDF() {
  const expenses = await db.getAll('expenses');
  expenses.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || (b.createdAt || 0) - (a.createdAt || 0));

  const total = expenses.filter(e => e.type !== 'credit').reduce((s, e) => s + e.amount, 0);
  const dateStr = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const rows = expenses.map(e => {
    const cat = getCat(e.category);
    const d = new Date(e.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const isCredit = e.type === 'credit';
    return `<tr>
      <td>${d}${e.time ? `<div style="font-size:11px;color:#666">${e.time}</div>` : ''}</td>
      <td>${e.merchant || cat.name}</td>
      <td><span class="cat-badge">${cat.emoji} ${cat.name}</span></td>
      <td>${isCredit ? 'Credit' : 'Debit'}</td>
      <td class="amt" style="color:${isCredit ? '#10b981' : '#1a0d18'}">${isCredit ? '+' : '-'}₹${e.amount.toLocaleString('en-IN')}</td>
      <td>${e.method || ''}</td>
      <td class="note">${e.note || ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Expense Report — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a0d18; padding: 32px; font-size: 13px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; border-bottom: 2px solid #D99B84; padding-bottom: 12px; }
  h1 { font-size: 22px; font-weight: 800; color: #D99B84; }
  .sub { font-size: 12px; color: #888; margin-top: 2px; }
  .total-box { text-align: right; }
  .total-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .total-val { font-size: 26px; font-weight: 800; color: #1a0d18; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #666; padding: 8px 10px; border-bottom: 1px solid #eee; background: #fafafa; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  .amt { font-weight: 700; text-align: right; white-space: nowrap; }
  .note { color: #888; font-size: 12px; }
  .cat-badge { background: #f0ebe8; border-radius: 12px; padding: 2px 8px; white-space: nowrap; }
  tfoot td { padding: 10px; font-weight: 700; font-size: 14px; border-top: 2px solid #D99B84; }
  tfoot .amt { color: #D99B84; font-size: 16px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Expense Report</h1>
    <div class="sub">Generated ${dateStr} · ${expenses.length} transactions</div>
  </div>
  <div class="total-box">
    <div class="total-label">Total Living Expenses</div>
    <div class="total-val">₹${total.toLocaleString('en-IN')}</div>
  </div>
</header>
<table>
  <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Type</th><th style="text-align:right">Amount</th><th>Method</th><th>Note</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="4"><strong>Total Spent</strong></td><td class="amt">₹${total.toLocaleString('en-IN')}</td><td colspan="2"></td></tr></tfoot>
</table>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }
}

function mountTransactions() {
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');

  let debounceTimer = null;
  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    if (searchClear) searchClear.style.display = e.target.value ? 'flex' : 'none';
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderView();
      const newInput = document.getElementById('search-input');
      if (newInput) {
        newInput.focus();
        const len = newInput.value.length;
        newInput.setSelectionRange(len, len);
      }
    }, 200);
  });

  searchClear?.addEventListener('click', () => {
    state.searchQuery = '';
    renderView();
    const newInput = document.getElementById('search-input');
    if (newInput) newInput.focus();
  });

  document.getElementById('cat-filter')?.addEventListener('change', e => {
    state.filterCategory = e.target.value || null;
    renderView();
  });

  document.getElementById('type-filter')?.addEventListener('change', e => {
    state.filterType = e.target.value || 'all';
    renderView();
  });

  document.getElementById('range-filter')?.addEventListener('change', e => {
    state.filterDateRange = e.target.value || 'month';
    renderView();
  });

  document.getElementById('reset-txn-filters')?.addEventListener('click', () => {
    state.searchQuery = '';
    state.filterCategory = null;
    state.filterType = 'all';
    state.filterDateRange = 'month';
    renderView();
  });

  document.getElementById('txn-quick-add-btn')?.addEventListener('click', () => openAddModal());
  document.getElementById('open-import-btn')?.addEventListener('click', () => openImportModal());
  document.getElementById('open-export')?.addEventListener('click', () => openModal('export-modal'));
  document.getElementById('cancel-export')?.addEventListener('click', () => closeModal('export-modal'));
  document.getElementById('export-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('export-modal');
  });
  document.getElementById('export-csv')?.addEventListener('click', async () => {
    closeModal('export-modal');
    await exportCSV();
  });
  document.getElementById('export-pdf')?.addEventListener('click', async () => {
    closeModal('export-modal');
    await exportPDF();
  });

  // Table sorting
  document.querySelectorAll('.txn-th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'amount' ? 'desc' : 'asc';
      }
      renderView();
    });
  });

  // Row click to edit
  document.querySelectorAll('.txn-row').forEach(row => {
    row.addEventListener('click', async e => {
      if (e.target.closest('.row-action-btn')) return;
      const id = parseInt(row.dataset.id);
      const expense = await db.get('expenses', id);
      if (expense) { playCategorySound(expense.category); openAddModal(expense); }
    });
  });

  // Edit button
  document.querySelectorAll('.edit-txn-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const expense = await db.get('expenses', id);
      if (expense) { playCategorySound(expense.category); openAddModal(expense); }
    });
  });

  // Delete button with 5-Second Undo Toast
  document.querySelectorAll('.txn-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const item = await db.get('expenses', id);
      if (!item) return;

      await db.delete('expenses', id);
      gistSync();
      playDelete();
      state.undoItem = item;

      showToast(`Deleted ${item.merchant || 'transaction'}`, 'success', {
        label: 'Undo',
        onClick: async () => {
          if (state.undoItem) {
            await db.add('expenses', state.undoItem);
            state.undoItem = null;
            showToast('Transaction restored!', 'success');
            renderView();
          }
        }
      });
      renderView();
    });
  });
}

// ─── Budgets ──────────────────────────────────────────────────────────────────
async function renderBudgets() {
  const month = state.currentMonth;
  const budgets = await db.getAll('budgets');
  const monthBudgets = budgets.filter(b => b.month === month);
  const expenses = await db.getByIndex('expenses', 'month', month);
  const allDebitExpenses = expenses.filter(e => e.type !== 'credit');
  const spentByCat = {};
  for (const e of allDebitExpenses) spentByCat[e.category] = (spentByCat[e.category] || 0) + e.amount;

  // Monthly spending limit derives from living expense category budgets (excluding savings)
  const livingBudgets = monthBudgets.filter(b => !isSavingsCategory(b.categoryId));
  const livingDebitExpenses = allDebitExpenses.filter(e => !isSavingsCategory(e.category));
  const overallBudget = (livingBudgets.length > 0 ? livingBudgets : monthBudgets).reduce((s, b) => s + b.amount, 0);
  const totalSpent = (livingBudgets.length > 0 ? livingDebitExpenses : allDebitExpenses).reduce((s, e) => s + e.amount, 0);

  // Overall budget card calculation with accurate exact-limit logic
  const ovPct = overallBudget > 0 ? (totalSpent / overallBudget) * 100 : 0;
  const ovBarPct = Math.min(ovPct, 100);
  let ovStatus = 'ok';
  let ovRemainingLabel = 'Left';
  let ovValClass = 'success-text';

  if (overallBudget > 0) {
    if (totalSpent > overallBudget) {
      ovStatus = 'over';
      ovRemainingLabel = 'Over by';
      ovValClass = 'danger-text';
    } else if (totalSpent === overallBudget) {
      ovStatus = 'warn';
      ovRemainingLabel = 'Left';
      ovValClass = 'warn-text';
    } else if (ovPct >= 80) {
      ovStatus = 'warn';
      ovRemainingLabel = 'Left';
      ovValClass = 'warn-text';
    } else {
      ovStatus = 'ok';
      ovRemainingLabel = 'Left';
      ovValClass = 'success-text';
    }
  }
  const ovRemaining = overallBudget - totalSpent;

  const overallCard = overallBudget > 0 ? `
  <div class="overall-budget-card card">
    <div class="overall-budget-header">
      <div>
        <div class="overall-budget-label">Monthly Spending Limit</div>
        <div class="hint-text" style="margin:0 0 2px">Auto-adjusts to the sum of your category budgets</div>
        <div class="overall-budget-amount">${fmt(overallBudget)}</div>
      </div>
      <button class="btn-primary-sm" id="add-budget-btn">＋ Add Budget</button>
    </div>
    <div class="progress-bar-wrap" style="margin-top:16px;height:10px">
      <div class="progress-bar ${ovStatus}" style="width:${ovBarPct.toFixed(1)}%"></div>
    </div>
    <div class="overall-budget-stats">
      <div class="overall-budget-stat">
        <span class="overall-budget-stat-label">Total Spent</span>
        <span class="overall-budget-stat-val">${fmt(totalSpent)}</span>
      </div>
      <div class="overall-budget-stat overall-budget-stat-center">
        <span class="overall-budget-stat-pct ${ovStatus}-text">${ovPct.toFixed(0)}%</span>
        <span class="overall-budget-stat-sub">of budget</span>
      </div>
      <div class="overall-budget-stat overall-budget-stat-right">
        <span class="overall-budget-stat-label">${ovRemainingLabel}</span>
        <span class="overall-budget-stat-val ${ovValClass}">${fmt(Math.abs(ovRemaining))}</span>
      </div>
    </div>
  </div>` : `
  <div class="overall-budget-empty card">
    <div class="overall-budget-empty-inner">
      <div class="overall-budget-empty-icon">🎯</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:16px;margin-bottom:3px">Monthly limit: not set</div>
        <div class="hint-text" style="margin:0">Add category budgets — the limit will automatically calculate as their sum.</div>
      </div>
      <button class="btn-primary-sm" id="add-budget-btn">＋ Add Budget</button>
    </div>
  </div>`;

  const budgetRows = monthBudgets.length === 0
    ? '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎯</div><div class="empty-state-title">No category budgets yet</div><div class="empty-state-desc">Tap "+ Add Budget" to set category spending targets for this month.</div></div>'
    : monthBudgets.map(b => {
        const cat = getCat(b.categoryId);
        const spent = spentByCat[b.categoryId] || 0;
        const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
        const barPct = Math.min(pct, 100);

        let status = 'ok';
        let leftText = '';
        if (spent > b.amount) {
          status = 'over';
          leftText = `Over by ${fmt(spent - b.amount)}`;
        } else if (spent === b.amount) {
          status = 'warn';
          leftText = `₹0.00 left (100% used)`;
        } else if (pct >= 80) {
          status = 'warn';
          leftText = `${fmt(b.amount - spent)} left`;
        } else {
          status = 'ok';
          leftText = `${fmt(b.amount - spent)} left`;
        }

        return `
          <div class="budget-item card" data-id="${b.id}" style="border-left:4px solid ${cat.color || 'var(--brand)'}">
            <div class="budget-top">
              <span class="budget-cat" style="display:inline-flex;align-items:center;gap:6px">${getCatBadge(cat, 14)} <span>${cat.name}</span></span>
              <span class="budget-amounts ${status}">${fmt(spent)} / ${fmt(b.amount)}</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar ${status}" style="width:${barPct.toFixed(1)}%"></div>
            </div>
            <div class="budget-bottom">
              <span class="budget-left ${status}">
                ${leftText}
              </span>
              <button class="btn-link btn-budget-edit" data-budget-edit="${b.id}" data-budget-cat="${b.categoryId}" data-budget-amount="${b.amount}">Edit</button>
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
    <div>
      <h2 class="view-title">Budgets</h2>
      <div class="card-subheading">${monthLabel(month)}</div>
    </div>
    <button class="btn-primary-sm" id="add-budget">＋ Add Budget</button>
  </div>
  ${overallCard}
  <div class="budget-section-header">
    <div class="budget-section-label">Category Budgets</div>
  </div>
  <div id="budget-list">${budgetRows}</div>
</div>

<div class="modal" id="budget-modal">
  <div class="modal-sheet">
    <div class="modal-handle"></div>
    <div class="modal-header">
      <div class="modal-title" id="budget-modal-title">Set Budget</div>
      <button type="button" class="modal-close-btn" id="close-budget-modal-btn">✕</button>
    </div>
    <form id="budget-form">
      <input type="hidden" id="b-id">
      <input type="hidden" id="b-cat-id">
      <label class="field-label">Category</label>
      <select id="b-cat" class="field-input">${catOptionsForModal}</select>
      <label class="field-label">Monthly Budget (₹)</label>
      <input type="number" id="b-amount" inputmode="decimal" placeholder="0" class="field-input" required min="1" step="1">
      <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
        <button type="submit" class="btn-primary" style="margin-top:0">Save Budget</button>
        <button type="button" class="btn-secondary" id="cancel-budget" style="margin-top:0">Cancel</button>
        <button type="button" class="btn-secondary danger" id="delete-budget" style="display:none;margin-top:0">Delete Budget</button>
        <button type="button" class="btn-secondary danger" id="delete-budget-cat" style="display:none;margin-top:0">Delete Category</button>
      </div>
    </form>
  </div>
</div>
`;
}

async function mountBudgets() {
  const openAddBudget = () => {
    document.getElementById('b-id').value = '';
    document.getElementById('b-amount').value = '';
    document.getElementById('budget-modal-title').textContent = 'Set Budget';
    document.getElementById('delete-budget').style.display = 'none';
    document.getElementById('delete-budget-cat').style.display = 'none';
    openModal('budget-modal');
  };

  document.getElementById('add-budget')?.addEventListener('click', openAddBudget);
  document.getElementById('add-budget-btn')?.addEventListener('click', openAddBudget);

  document.querySelectorAll('[data-budget-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('b-id').value = btn.dataset.budgetEdit;
      document.getElementById('b-cat-id').value = btn.dataset.budgetCat;
      document.getElementById('b-cat').value = btn.dataset.budgetCat;
      document.getElementById('b-amount').value = btn.dataset.budgetAmount;
      document.getElementById('budget-modal-title').textContent = 'Edit Budget';
      document.getElementById('delete-budget').style.display = 'block';
      document.getElementById('delete-budget-cat').style.display = 'block';
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

  document.getElementById('delete-budget-cat')?.addEventListener('click', async () => {
    const catId = document.getElementById('b-cat-id').value;
    if (!catId) return;
    // Delete the category and any budgets for it
    await db.delete('categories', catId);
    // Remove all budgets tied to this category
    const allBudgets = await db.getAll('budgets');
    for (const b of allBudgets.filter(b => b.categoryId === catId)) await db.delete('budgets', b.id);
    state.categories = await db.getAll('categories');
    closeModal('budget-modal');
    showToast('Category deleted');
    gistSync();
    renderView();
  });

  document.getElementById('cancel-budget')?.addEventListener('click', () => closeModal('budget-modal'));
  document.getElementById('close-budget-modal-btn')?.addEventListener('click', () => closeModal('budget-modal'));
  document.getElementById('budget-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('budget-modal');
  });

  // Warn if any budget is ≥80%
  const warnBars = document.querySelectorAll('#budget-list .progress-bar.warn, #budget-list .progress-bar.over, .overall-budget-card .progress-bar.warn, .overall-budget-card .progress-bar.over');
  if (warnBars.length > 0) setTimeout(() => playBudgetWarn(), 400);

  document.getElementById('budget-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const catId = document.getElementById('b-cat').value;
    const amount = parseAmount(document.getElementById('b-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
    const id = `${catId}-${state.currentMonth}`;
    await db.put('budgets', { id, categoryId: catId, month: state.currentMonth, amount });
    closeModal('budget-modal');
    showToast('Budget saved!', 'success');
    renderView();
  });
}

// ─── Credit Cards & Bill Tracking ─────────────────────────────────────────────
const DEFAULT_CREDIT_CARDS = [
  { id: 'sbi', name: 'SBI Credit Card', bank: 'SBI Card', last4: '9103', color: '#1E56A0', billingDay: 18, dueDay: 8 }
];

async function getCreditCards() {
  return DEFAULT_CREDIT_CARDS;
}

async function saveCreditCards(cards) {
  await db.setSetting('credit_cards', cards);
  gistSync();
}

async function getCardPayments() {
  const list = await db.getSetting('credit_card_payments', []);
  return Array.isArray(list) ? list : [];
}

async function saveCardPayment(payment) {
  const list = await getCardPayments();
  const id = payment.id || `cc-pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  list.push({
    id,
    cardId: 'sbi',
    month: payment.month,
    amount: Number(payment.amount) || 0,
    date: payment.date || today(),
    note: payment.note || '',
    createdAt: Date.now()
  });
  await db.setSetting('credit_card_payments', list);
  gistSync();
}

async function deleteCardPayment(id) {
  let list = await getCardPayments();
  list = list.filter(p => p.id !== id);
  await db.setSetting('credit_card_payments', list);
  gistSync();
}

function isCreditCardExpense(e) {
  if (!e || e.type === 'credit') return false;

  const b = (e.bank || '').toLowerCase();
  const n = (e.note || '').toLowerCase();

  // 1. Exclude savings accounts debits (UPI, NetBanking, transfers from savings accounts)
  if (b.includes('savings') || b.includes('sbi account') || n.includes('savings') || n.includes('sbi account')) {
    return false;
  }

  // 2. Exclude other cards or banks (Slice, HDFC, ICICI, Axis, etc.)
  if (b.includes('slice') || n.includes('slice')) return false;
  if (b.includes('hdfc') || n.includes('hdfc')) return false;
  if (b.includes('icici') || n.includes('icici')) return false;
  if (b.includes('axis') || n.includes('axis')) return false;

  // 3. ONLY payments made FROM SBI Credit Card:
  if (e.cardId === 'sbi') return true;
  if (b.includes('sbi credit') || b.includes('sbi card') || b === 'sbicard') return true;
  if (n.includes('sbi credit') || n.includes('sbi card') || n.includes('sbicard')) return true;
  if (e.method === 'Card' && b.includes('sbi')) return true;

  return false;
}

function calculateCreditCardMonthlySummary(allExpenses, allPayments, targetMonth, targetCardId = 'sbi') {
  // Only payments made FROM SBI Credit Card
  const cardExpenses = allExpenses.filter(e => isCreditCardExpense(e));

  // Only payments made TO SBI Credit Card
  const cardPayments = allPayments.filter(p => p.cardId === 'sbi' || p.cardId === 'all' || (p.note && p.note.toLowerCase().includes('sbi')));

  const monthSet = new Set();
  cardExpenses.forEach(e => {
    const ym = e.month || e.date?.slice(0, 7);
    if (ym) monthSet.add(ym);
  });
  cardPayments.forEach(p => {
    if (p.month) monthSet.add(p.month);
  });
  monthSet.add(targetMonth);

  const sortedMonths = Array.from(monthSet).sort();

  let runningCarryOver = 0;
  const history = {};

  for (const m of sortedMonths) {
    const mExpenses = cardExpenses.filter(e => (e.month || e.date?.slice(0, 7)) === m);
    const mPayments = cardPayments.filter(p => p.month === m);

    const spendings = mExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const paid = mPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    const openingBalance = runningCarryOver;
    const totalDue = openingBalance + spendings;
    const closingBalance = Math.max(0, totalDue - paid);

    let status = 'no_spendings';
    if (totalDue > 0) {
      if (closingBalance === 0) status = 'paid_full';
      else if (paid > 0) status = 'partially_paid';
      else status = 'due';
    }

    const percentPaid = totalDue > 0 ? Math.min(100, Math.round((paid / totalDue) * 100)) : 100;

    history[m] = {
      month: m,
      openingBalance,
      spendings,
      totalDue,
      paid,
      closingBalance,
      status,
      percentPaid,
      expenses: mExpenses,
      payments: mPayments
    };

    runningCarryOver = closingBalance;
  }

  return {
    current: history[targetMonth] || {
      month: targetMonth,
      openingBalance: 0,
      spendings: 0,
      totalDue: 0,
      paid: 0,
      closingBalance: 0,
      status: 'no_spendings',
      percentPaid: 100,
      expenses: [],
      payments: []
    },
    history,
    sortedMonths
  };
}

async function renderCreditCards() {
  const month = state.currentMonth || today().slice(0, 7);
  const cards = await getCreditCards();
  const selectedCardId = state.selectedCreditCard || 'all';
  const currentCard = cards.find(c => c.id === selectedCardId) || cards[0] || { id: 'all', name: 'All Cards', bank: 'All Cards', color: '#D99B84' };

  const allExpenses = await db.getAll('expenses');
  const allPayments = await getCardPayments();

  const { current: summary, history, sortedMonths } = calculateCreditCardMonthlySummary(allExpenses, allPayments, month, selectedCardId);

  // Month navigation labels
  const [curY, curM] = month.split('-').map(Number);
  const nextMonthYm = curM === 12 ? `${curY + 1}-01` : `${curY}-${String(curM + 1).padStart(2, '0')}`;
  const prevMonthYm = curM === 1 ? `${curY - 1}-12` : `${curY}-${String(curM - 1).padStart(2, '0')}`;

  // Status badge
  let statusBadge = '';
  if (summary.totalDue === 0) {
    statusBadge = '<span class="cc-status-pill neutral">● No Spendings</span>';
  } else if (summary.closingBalance === 0) {
    statusBadge = '<span class="cc-status-pill positive">✓ Paid in Full</span>';
  } else if (summary.paid > 0) {
    statusBadge = `<span class="cc-status-pill warning">● Partially Paid (${summary.percentPaid}%)</span>`;
  } else {
    statusBadge = '<span class="cc-status-pill negative">● Payment Due</span>';
  }

  // Card selector tabs
  const cardTabsHtml = cards.map(c => {
    const isAct = c.id === selectedCardId;
    return `
      <button class="cc-tab-pill ${isAct ? 'active' : ''}" data-card-id="${c.id}" type="button">
        <span class="cc-tab-dot" style="background:${c.color || '#D99B84'}"></span>
        <span class="cc-tab-name">${c.name}</span>
        ${c.last4 ? `<span class="cc-tab-last4">··${c.last4}</span>` : ''}
      </button>
    `;
  }).join('');

  // Payments list HTML
  const paymentsListHtml = summary.payments.length === 0
    ? `
      <div style="padding:24px 16px;text-align:center;color:var(--text3);font-size:13px;background:var(--surface2);border-radius:var(--radius-sm)">
        No bill repayments recorded for SBI Credit Card in ${monthLabel(month)} yet. Click <strong>"+ Record Payment"</strong> when you pay off your card bill.
      </div>
    `
    : `
      <div class="cc-pay-list">
        ${summary.payments.map(p => `
          <div class="cc-pay-item">
            <div class="cc-pay-left">
              <div class="cc-pay-icon">✓</div>
              <div class="cc-pay-meta">
                <span class="cc-pay-title">${p.note || 'SBI Credit Card Bill Payment'}</span>
                <span class="cc-pay-date">${p.date} · Credited towards ${monthLabel(month)} bill</span>
              </div>
            </div>
            <div class="cc-pay-right">
              <span class="cc-pay-amt">- ${fmtCurrency(p.amount, true)}</span>
              <button class="cc-pay-del-btn" data-pay-id="${p.id}" title="Delete payment record">✕</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

  // Card transactions list HTML
  const sortedExpenses = [...summary.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const expensesListHtml = sortedExpenses.length === 0
    ? `
      <div class="empty-state" style="padding:32px 0">
        <div class="empty-icon">💳</div>
        <div class="empty-title">No SBI Card transactions in ${monthLabel(month)}</div>
        <div class="empty-sub">Only charges made from your SBI Credit Card or parsed from SBI Card emails appear here.</div>
      </div>
    `
    : `
      <div class="recent-list">
        ${sortedExpenses.map(e => {
          const cat = getCat(e.category);
          const initial = getMerchantInitial(e.merchant || cat.name);
          const avatarColor = getMerchantColor(e.merchant || cat.name);
          return `
            <div class="recent-item txn-row-item" data-id="${e.id}">
              <div class="merchant-cell">
                <div class="merchant-avatar" style="background:${avatarColor}">${initial}</div>
                <div class="merchant-meta">
                  <span class="merchant-title">${e.merchant || cat.name}</span>
                  <span class="merchant-note">
                    <span class="cat-pill" style="background:${cat.color}20;color:${cat.color};font-size:11px;padding:2px 8px">${getCatBadge(cat, 12)} <span>${cat.name}</span></span>
                    <span class="method-tag" style="font-size:10px;padding:1px 5px">SBI Card</span>
                    <span class="recent-time" style="font-size:11px;color:var(--text3)">${e.date}${e.time ? ` · ${e.time}` : ''}</span>
                    ${e.note ? `<span>· ${e.note}</span>` : ''}
                  </span>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:12px">
                <span class="amount-cell debit">-${fmtCurrency(e.amount, true)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

  // Multi-month History Carousel HTML
  const recentHistoryMonths = (sortedMonths.length > 0 ? sortedMonths : [month]).slice(-6);
  const historyCarouselHtml = recentHistoryMonths.map(m => {
    const h = history[m] || { spendings: 0, paid: 0, closingBalance: 0 };
    const isCur = m === month;
    const isPaid = h.closingBalance === 0 && (h.spendings > 0 || h.openingBalance > 0);
    return `
      <div class="cc-month-card ${isCur ? 'active' : ''}" data-jump-month="${m}">
        <div class="cc-mc-month">${monthLabel(m)}</div>
        <div class="cc-mc-spent">Spent: ${fmtCurrency(h.spendings, false)}</div>
        <div class="cc-mc-spent">Paid: ${fmtCurrency(h.paid, false)}</div>
        <div class="cc-mc-carry" style="color:${isPaid ? 'var(--income)' : (h.closingBalance > 0 ? 'var(--expense)' : 'var(--text3)')}">
          ${isPaid ? '✓ Paid Full' : (h.closingBalance > 0 ? `Carried: ${fmtCurrency(h.closingBalance, false)}` : '₹0.00')}
        </div>
      </div>
    `;
  }).join('');

  return `
<div class="view-cards">
  <!-- Top Header Row -->
  <div class="cc-header-row">
    <div class="cc-title-area">
      <h2>SBI Credit Card Tracker</h2>
      <p>Only payments made from and to SBI Credit Card are counted here</p>
    </div>
    <div class="cc-header-actions">
      <button class="btn-primary" id="btn-open-card-pay">✓ Record Payment</button>
      ${summary.closingBalance > 0 ? `<button class="btn-secondary" id="btn-quick-pay-full" style="color:var(--brand)">⚡ Pay in Full (${fmtCurrency(summary.closingBalance, false)})</button>` : ''}
      <button class="btn-secondary" id="btn-open-card-spend">+ Add SBI Card Spend</button>
    </div>
  </div>

  <!-- Card Selector Pill Tabs -->
  <div class="cc-tabs-bar">
    <span class="cc-tab-pill active">
      <span class="cc-tab-dot" style="background:#1E56A0"></span>
      <span class="cc-tab-name">SBI Credit Card (Active)</span>
      <span class="cc-tab-last4">··9103</span>
    </span>
  </div>

  <!-- Hero Section: Virtual Luxury Card + 4 KPI Cards -->
  <div class="cc-hero-grid">
    <!-- Virtual Credit Card Visual -->
    <div class="virtual-credit-card" style="border-color:${currentCard.color ? currentCard.color + '44' : 'rgba(223, 196, 152, 0.22)'}">
      <div class="vcc-top-row">
        <span class="vcc-bank-badge">${currentCard.bank || 'CREDIT CARD'}</span>
        ${statusBadge}
      </div>

      <div class="vcc-chip-row">
        <div class="vcc-chip"></div>
        <svg class="vcc-contactless" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8.5 10a4 4 0 0 1 0 5"></path>
          <path d="M12 7.5a7 7 0 0 1 0 9"></path>
          <path d="M15.5 5a10 10 0 0 1 0 13"></path>
        </svg>
      </div>

      <div class="vcc-number">•••• •••• •••• ${currentCard.last4 || (currentCard.id === 'all' ? 'MULTI' : '8842')}</div>

      <div class="vcc-bottom-row">
        <div class="vcc-cardholder">
          <span class="vcc-label">CARD NAME</span>
          <span class="vcc-name">${currentCard.name}</span>
        </div>
        <div class="vcc-cycle-tag">
          ${monthLabel(month)}
        </div>
      </div>
    </div>

    <!-- 4 KPI Summary Cards -->
    <div class="cc-kpi-subgrid">
      <!-- 1. Total Bill Due -->
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-title">Total Bill Due</span>
          <div class="kpi-icon-wrap" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
          </div>
        </div>
        <div class="kpi-val" style="color:${summary.closingBalance > 0 ? 'var(--expense)' : (summary.totalDue > 0 ? 'var(--income)' : 'var(--text)')}">
          ${fmtCurrency(summary.totalDue, true)}
        </div>
        <div class="kpi-footer">
          <span>Carried: ${fmtCurrency(summary.openingBalance, false)} + Charges: ${fmtCurrency(summary.spendings, false)}</span>
        </div>
      </div>

      <!-- 2. New Card Spendings -->
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-title">New Spendings</span>
          <div class="kpi-icon-wrap" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="7" y1="17" x2="17" y2="7"></line>
              <polyline points="17 7 17 17 7 17"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-val">${fmtCurrency(summary.spendings, true)}</div>
        <div class="kpi-footer">
          <span>${summary.expenses.length} transaction${summary.expenses.length !== 1 ? 's' : ''} in ${monthLabel(month).split(' ')[0]}</span>
        </div>
      </div>

      <!-- 3. Paid Off -->
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-title">Paid Off</span>
          <div class="kpi-icon-wrap" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-val" style="color:var(--income)">${fmtCurrency(summary.paid, true)}</div>
        <div class="cc-progress-wrap">
          <div class="cc-progress-track">
            <div class="cc-progress-fill" style="width:${summary.percentPaid}%"></div>
          </div>
        </div>
        <div class="kpi-footer">
          <span>${summary.percentPaid}% paid (${summary.payments.length} repayment${summary.payments.length !== 1 ? 's' : ''})</span>
        </div>
      </div>

      <!-- 4. Carried Over to Next Month -->
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-title">Carried Over to ${monthLabel(nextMonthYm).split(' ')[0]}</span>
          <div class="kpi-icon-wrap" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </div>
        <div class="kpi-val" style="color:${summary.closingBalance > 0 ? 'var(--expense)' : 'var(--income)'}">
          ${fmtCurrency(summary.closingBalance, true)}
        </div>
        <div class="kpi-footer">
          <span>${summary.closingBalance === 0 ? 'Zero balance carried forward' : `Unpaid balance rolling to ${monthLabel(nextMonthYm)}`}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Statement & Month-to-Month Carryover Ledger Card -->
  <div class="cc-ledger-card">
    <div class="cc-ledger-title-row">
      <div class="cc-ledger-heading">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span>Monthly Statement & Rollover Ledger</span>
      </div>
      <span style="font-size:12.5px;color:var(--text3)">Cycle: ${monthLabel(month)}</span>
    </div>

    <div class="cc-ledger-table">
      <div class="cc-ledger-row">
        <span><span class="cc-ledger-symbol">+</span> Opening Balance Carried Over from ${monthLabel(prevMonthYm)}</span>
        <span class="${summary.openingBalance > 0 ? 'cc-amt-amber' : ''}">${fmtCurrency(summary.openingBalance, true)}</span>
      </div>
      <div class="cc-ledger-row">
        <span><span class="cc-ledger-symbol">+</span> New Charges & Debits in ${monthLabel(month)}</span>
        <span class="${summary.spendings > 0 ? 'cc-amt-red' : ''}">${fmtCurrency(summary.spendings, true)}</span>
      </div>
      <div class="cc-ledger-row total-due">
        <span><span class="cc-ledger-symbol">=</span> <strong>Total Bill Amount Due</strong></span>
        <strong>${fmtCurrency(summary.totalDue, true)}</strong>
      </div>
      <div class="cc-ledger-row">
        <span><span class="cc-ledger-symbol">-</span> Amount Paid Off / Payments Credited</span>
        <span class="cc-amt-green">${summary.paid > 0 ? `- ${fmtCurrency(summary.paid, true)}` : '₹0.00'}</span>
      </div>
      <div class="cc-ledger-row closing-row">
        <span><span class="cc-ledger-symbol">=</span> <strong>Outstanding Balance Carried Over to ${monthLabel(nextMonthYm)}</strong></span>
        <strong style="color:${summary.closingBalance > 0 ? 'var(--expense)' : 'var(--income)'}">
          ${fmtCurrency(summary.closingBalance, true)}
        </strong>
      </div>
    </div>

    <!-- Status explanation alert -->
    <div style="padding:14px 16px;border-radius:var(--radius-sm);background:${summary.closingBalance === 0 && summary.totalDue > 0 ? 'var(--income-light)' : (summary.closingBalance > 0 ? 'var(--warning-light)' : 'var(--surface2)')};border:1px solid ${summary.closingBalance === 0 && summary.totalDue > 0 ? 'var(--income-border)' : (summary.closingBalance > 0 ? 'var(--warning-border)' : 'var(--border-subtle)')};display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="font-size:13px;color:var(--text);line-height:1.4">
        ${summary.totalDue === 0 ? '✨ No card charges or unpaid carryover for this month.' : (summary.closingBalance === 0 ? '🎉 <strong>Paid in Full!</strong> Your entire card bill has been settled. ₹0.00 will be carried over to next month.' : `🔔 <strong>${fmtCurrency(summary.closingBalance, true)}</strong> remains outstanding and will be carried over into ${monthLabel(nextMonthYm)}'s bill.`)}
      </div>
      ${summary.closingBalance > 0 ? `
        <button class="btn-primary" id="btn-ledger-pay-btn" style="font-size:12px;padding:6px 14px">Pay Balance (${fmtCurrency(summary.closingBalance, false)}) →</button>
      ` : ''}
    </div>
  </div>

  <!-- Recorded Payments Section -->
  <div class="dashboard-card" style="margin-bottom:24px">
    <div class="card-header-row">
      <div>
        <div class="card-heading">Bill Payments Recorded</div>
        <div class="card-subheading">Repayments applied against ${monthLabel(month)} bill</div>
      </div>
      <button class="btn-link" id="btn-add-payment-link" style="font-size:12px;font-weight:600">+ Record Payment</button>
    </div>
    ${paymentsListHtml}
  </div>

  <!-- Transactions Charged to Credit Card -->
  <div class="dashboard-card" style="margin-bottom:24px">
    <div class="card-header-row">
      <div>
        <div class="card-heading">Card Transactions</div>
        <div class="card-subheading">All charges and debits billed to this card in ${monthLabel(month)}</div>
      </div>
      <span style="font-size:12px;font-weight:600;color:var(--text3)">Total: ${fmtCurrency(summary.spendings, false)}</span>
    </div>
    ${expensesListHtml}
  </div>

  <!-- Multi-Month Balance Carryover Timeline -->
  <div class="dashboard-card">
    <div class="card-header-row">
      <div>
        <div class="card-heading">Balance Rollover Timeline</div>
        <div class="card-subheading">Month-over-month card spendings, repayments, and carryovers</div>
      </div>
    </div>
    <div class="cc-history-carousel">
      ${historyCarouselHtml}
    </div>
  </div>
</div>
`;
}

function mountCreditCards() {
  // Card tab switching
  document.querySelectorAll('.cc-tab-pill[data-card-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedCreditCard = btn.dataset.cardId;
      playNav();
      renderView();
    });
  });

  // Add new card pill
  document.getElementById('btn-add-new-card-pill')?.addEventListener('click', () => {
    openCardManageModal();
  });

  // Manage cards button
  document.getElementById('btn-open-manage-cards')?.addEventListener('click', () => {
    openCardManageModal();
  });

  // Record payment button
  document.getElementById('btn-open-card-pay')?.addEventListener('click', () => {
    openCardPaymentModal();
  });
  document.getElementById('btn-add-payment-link')?.addEventListener('click', () => {
    openCardPaymentModal();
  });
  document.getElementById('btn-ledger-pay-btn')?.addEventListener('click', () => {
    openCardPaymentModal();
  });

  // 1-Click Pay in Full button
  document.getElementById('btn-quick-pay-full')?.addEventListener('click', async () => {
    const allExpenses = await db.getAll('expenses');
    const allPayments = await getCardPayments();
    const { current: summary } = calculateCreditCardMonthlySummary(allExpenses, allPayments, state.currentMonth, 'sbi');
    if (summary.closingBalance <= 0) return;

    if (confirm(`Mark entire remaining SBI Card bill of ${fmtCurrency(summary.closingBalance, true)} as paid for ${monthLabel(state.currentMonth)}?`)) {
      await saveCardPayment({
        cardId: 'sbi',
        month: state.currentMonth,
        amount: summary.closingBalance,
        date: today(),
        note: `Full payment for ${monthLabel(state.currentMonth)} SBI Card bill`
      });
      playAdd();
      showToast(`Recorded full payment of ${fmtCurrency(summary.closingBalance, true)} for SBI Credit Card!`, 'success');
      renderView();
    }
  });

  // Add Card Spend button
  document.getElementById('btn-open-card-spend')?.addEventListener('click', () => {
    openAddModal({ method: 'Card', cardId: 'sbi' });
  });

  // Delete payment record
  document.querySelectorAll('.cc-pay-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.payId;
      if (!pid) return;
      if (confirm('Delete this payment record? This will adjust the carried over balance.')) {
        await deleteCardPayment(pid);
        playDelete();
        showToast('Payment record removed', 'success');
        renderView();
      }
    });
  });

  // Click transaction to edit
  document.querySelectorAll('.view-cards .txn-row-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = parseInt(el.dataset.id);
      const expense = await db.get('expenses', id);
      if (expense) openAddModal(expense);
    });
  });

  // History timeline card click
  document.querySelectorAll('.cc-month-card[data-jump-month]').forEach(el => {
    el.addEventListener('click', () => {
      state.currentMonth = el.dataset.jumpMonth;
      playNav();
      renderView();
    });
  });
}

async function openCardPaymentModal(suggestedAmount = null, targetCardId = null) {
  const allExpenses = await db.getAll('expenses');
  const allPayments = await getCardPayments();
  const cardId = targetCardId || state.selectedCreditCard || 'all';
  const { current: summary } = calculateCreditCardMonthlySummary(allExpenses, allPayments, state.currentMonth, cardId);

  const dueAmount = suggestedAmount != null ? suggestedAmount : summary.closingBalance;
  const cards = await getCreditCards();

  const cardOptions = cards.map(c =>
    `<option value="${c.id}" ${c.id === cardId ? 'selected' : ''}>${c.name} ${c.last4 ? `(··${c.last4})` : ''}</option>`
  ).join('');

  const modalBody = document.getElementById('card-pay-modal-body');
  if (!modalBody) return;

  modalBody.innerHTML = `
    <div class="add-header">
      <button class="modal-close-btn" id="close-card-pay-btn" type="button">✕</button>
      <h2>Record SBI Credit Card Payment</h2>
    </div>

    <form id="card-pay-form" autocomplete="off">
      <div class="card-pay-context-box">
        <div class="cp-context-label">Outstanding Bill for <strong>SBI Credit Card (${monthLabel(state.currentMonth)})</strong></div>
        <div class="cp-context-amount">${fmtCurrency(summary.closingBalance, true)}</div>
      </div>

      <label class="field-label">Amount Paid</label>
      <div class="amount-input-wrap">
        <span class="currency-sym">₹</span>
        <input type="number" id="cp-amount" inputmode="decimal" placeholder="0.00" value="${dueAmount > 0 ? dueAmount : ''}" required step="0.01" min="0.01" class="amount-input">
      </div>

      <div class="quick-amounts" style="margin-bottom:14px">
        ${dueAmount > 0 ? `
          <button type="button" class="quick-amt-chip" id="cp-chip-full" data-amt="${dueAmount}">Pay Full (₹${fmtCurrency(dueAmount, false)})</button>
          <button type="button" class="quick-amt-chip" id="cp-chip-half" data-amt="${Math.round(dueAmount / 2)}">Pay Half (₹${fmtCurrency(Math.round(dueAmount / 2), false)})</button>
        ` : ''}
        <button type="button" class="quick-amt-chip" data-amt="5000">+₹5,000</button>
        <button type="button" class="quick-amt-chip" data-amt="10000">+₹10,000</button>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="field-label">Payment Date</label>
          <input type="date" id="cp-date" value="${today()}" class="field-input" required>
        </div>
        <div class="form-group">
          <label class="field-label">Credit Card</label>
          <input type="text" value="SBI Credit Card (··9103)" class="field-input" readonly style="opacity:0.9">
          <input type="hidden" id="cp-card-select" value="sbi">
        </div>
      </div>

      <label class="field-label">Note / Payment Method (optional)</label>
      <input type="text" id="cp-note" placeholder="e.g. Paid via Slice Savings Account, SBI UPI, Cred" class="field-input">

      <label class="form-check-label" style="display:flex;align-items:center;gap:8px;margin:14px 0 10px;cursor:pointer;font-size:13px;color:var(--text2)">
        <input type="checkbox" id="cp-record-expense-chk" checked style="accent-color:var(--brand);width:16px;height:16px">
        <span>Also log as an expense under Debt Repayment (deducts from bank balance)</span>
      </label>

      <div id="cp-source-account-row" style="margin-bottom:14px">
        <label class="field-label">Paid From Account (Debit Source)</label>
        <select id="cp-source-account" class="field-input">
          <option value="Slice Savings Account">Slice Savings Account</option>
          <option value="SBI Savings Account">SBI Savings Account</option>
          <option value="HDFC Bank">HDFC Bank</option>
          <option value="Bank Account">Other Bank Account</option>
        </select>
      </div>

      <button type="submit" class="btn-primary" style="width:100%" id="cp-submit-btn">✓ Save Payment</button>
    </form>
  `;

  openModal('card-pay-modal');

  document.getElementById('close-card-pay-btn')?.addEventListener('click', () => closeModal('card-pay-modal'));
  const modalEl = document.getElementById('card-pay-modal');
  modalEl._backdropHandler = e => { if (e.target === modalEl) closeModal('card-pay-modal'); };
  modalEl.addEventListener('click', modalEl._backdropHandler);

  document.getElementById('cp-record-expense-chk')?.addEventListener('change', e => {
    const row = document.getElementById('cp-source-account-row');
    if (row) row.style.display = e.target.checked ? 'block' : 'none';
  });

  // Quick preset chips
  modalBody.querySelectorAll('.quick-amt-chip[data-amt]').forEach(chip => {
    chip.addEventListener('click', () => {
      const inp = document.getElementById('cp-amount');
      if (inp) {
        inp.value = chip.dataset.amt;
        inp.focus();
      }
    });
  });

  // Submit payment form
  document.getElementById('card-pay-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const amount = parseAmount(document.getElementById('cp-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');

    const paymentDate = document.getElementById('cp-date').value;
    const note = document.getElementById('cp-note').value.trim();
    const alsoExpense = document.getElementById('cp-record-expense-chk')?.checked;
    const sourceAccount = document.getElementById('cp-source-account')?.value || 'Slice Savings Account';

    await saveCardPayment({
      cardId: 'sbi',
      month: state.currentMonth,
      amount,
      date: paymentDate,
      note: note || `Bill payment for ${monthLabel(state.currentMonth)}`
    });

    if (alsoExpense) {
      await db.add('expenses', {
        amount,
        merchant: 'SBI Credit Card Bill Payment',
        category: 'debt',
        date: paymentDate,
        time: formatTimeIST(Date.now()),
        month: dateToMonth(paymentDate),
        method: 'Transfer',
        bank: sourceAccount,
        type: 'debit',
        note: `Credit card bill payment: ${note || monthLabel(state.currentMonth)}`.trim(),
        createdAt: Date.now()
      });
    }

    closeModal('card-pay-modal');
    playAdd();
    showToast(`Payment of ${fmtCurrency(amount, true)} recorded! Bill updated.`, 'success');
    renderView();
  });
}

async function openCardManageModal() {
  const cards = await getCreditCards();
  const modalBody = document.getElementById('card-manage-modal-body');
  if (!modalBody) return;

  const cardsListHtml = cards.map(c => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm);margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:10px;height:10px;border-radius:50%;background:${c.color || '#D99B84'}"></span>
        <div>
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${c.name}</div>
          <div style="font-size:11.5px;color:var(--text3)">${c.bank || 'Card'}${c.last4 ? ` · Ending in ${c.last4}` : ''}</div>
        </div>
      </div>
      ${c.id !== 'all' ? `
        <button class="btn-link danger cc-del-card-btn" data-del-card="${c.id}" style="font-size:12px">Remove</button>
      ` : '<span style="font-size:11px;color:var(--text3);font-weight:600">Default</span>'}
    </div>
  `).join('');

  modalBody.innerHTML = `
    <div class="add-header">
      <button class="modal-close-btn" id="close-card-manage-btn" type="button">✕</button>
      <h2>Manage Credit Cards</h2>
    </div>

    <div style="margin-bottom:18px">
      <label class="field-label" style="margin-bottom:8px">Registered Credit Cards</label>
      ${cardsListHtml}
    </div>

    <div style="border-top:1px solid var(--border);padding-top:16px">
      <h3 style="font-size:14px;font-weight:700;color:var(--text);margin:0 0 12px">＋ Add Custom Credit Card</h3>
      <form id="cc-add-card-form" autocomplete="off">
        <div class="form-group" style="margin-bottom:10px">
          <label class="field-label">Card Display Name</label>
          <input type="text" id="m-card-name" placeholder="e.g. HDFC Millennia, Slice Spark, SBI Elite" class="field-input" required>
        </div>

        <div class="form-row" style="margin-bottom:14px">
          <div class="form-group">
            <label class="field-label">Bank</label>
            <input type="text" id="m-card-bank" placeholder="e.g. HDFC, Slice, SBI, ICICI" class="field-input" required>
          </div>
          <div class="form-group">
            <label class="field-label">Last 4 Digits (optional)</label>
            <input type="text" id="m-card-last4" placeholder="e.g. 1234" maxlength="4" class="field-input">
          </div>
        </div>

        <button type="submit" class="btn-primary" style="width:100%">Save Credit Card</button>
      </form>
    </div>
  `;

  openModal('card-manage-modal');

  document.getElementById('close-card-manage-btn')?.addEventListener('click', () => closeModal('card-manage-modal'));
  const modalEl = document.getElementById('card-manage-modal');
  modalEl._backdropHandler = e => { if (e.target === modalEl) closeModal('card-manage-modal'); };
  modalEl.addEventListener('click', modalEl._backdropHandler);

  // Delete card button
  modalBody.querySelectorAll('.cc-del-card-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.delCard;
      if (confirm('Remove this credit card from your registered list?')) {
        let curCards = await getCreditCards();
        curCards = curCards.filter(c => c.id !== cid);
        await saveCreditCards(curCards);
        showToast('Card removed');
        openCardManageModal();
      }
    });
  });

  // Add custom card submit
  document.getElementById('cc-add-card-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('m-card-name').value.trim();
    const bank = document.getElementById('m-card-bank').value.trim();
    const last4 = document.getElementById('m-card-last4').value.trim();
    if (!name) return;

    const curCards = await getCreditCards();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    curCards.push({
      id: `${id}-${Date.now().toString(36).slice(-3)}`,
      name,
      bank,
      last4,
      color: '#D99B84'
    });

    await saveCreditCards(curCards);
    closeModal('card-manage-modal');
    showToast(`Added ${name}!`, 'success');
    renderView();
  });
}


// ─── Settings ─────────────────────────────────────────────────────────────────
const CAT_EMOJI_PRESETS = ['🍽️','🛒','🚌','🏪','💡','🏠','🎬','💊','📚','✈️','☕','🎁','💅','🐾','🏋️','🎵','🍕','🥗','🎮','💻','🧴','🌿','🎨','🏦','💰','🧾','🤝','🛠️','📱','🎯'];
const CAT_COLOR_PRESETS = [
  '#D99B84', '#DFC498', '#8FA998', '#B6899A', '#C9B7A6',
  '#B39D82', '#D4A373', '#7FB093', '#A0849D', '#C2847A',
  '#B87D74', '#A89B95', '#E5B09C', '#E0A96D', '#92C2A6',
  '#D97272', '#C47F68', '#9B8281', '#7D8C84', '#B38B7D'
];

async function renderSettings() {
  const gmailToken = await db.getSetting('gmail_token', null);
  const gmailExpiry = await db.getSetting('gmail_token_expiry', 0);
  const gmailConnected = !!(gmailToken && Date.now() < gmailExpiry);
  const gmailLastSync = await db.getSetting('gmail_last_sync', null);
  const gmailStartDate = await db.getSetting('gmail_start_date', '2026-10-07');
  const geminiApiKey = await db.getSetting('gemini_api_key', '');
  const smartCat = await db.getSetting('smart_categorize', true);

  return `
<div class="view-settings">
  <h2 class="view-title">Settings</h2>
  <div class="settings-grid">

  <!-- Smart Categorization -->
  <div class="settings-section card">
    <div class="settings-section-title">🧠 Smart Categorization</div>
    <div class="setting-row">
      <div>
        <div style="font-weight:600;margin-bottom:2px">Learn from my choices</div>
        <div class="hint-text">When you pick a category for a merchant, the app remembers it for next time.</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="smart-cat-toggle" ${smartCat ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <!-- Cards & Accounts Overview -->
  <div class="settings-section card">
    <div class="settings-section-title">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px">
        <rect x="2" y="5" width="20" height="14" rx="2"></rect>
        <line x1="2" y1="10" x2="22" y2="10"></line>
      </svg>
      Cards &amp; Accounts
    </div>
    <p class="hint-text" style="margin-bottom:12px">Your primary payment cards and linked banking accounts.</p>
    
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
      <!-- SBI Credit Card -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:#1E56A0"></span>
          <div>
            <div style="font-size:13.5px;font-weight:600;color:var(--text)">SBI Credit Card</div>
            <div style="font-size:11.5px;color:var(--text3)">Exclusively Counted in Credit Card Tracking &amp; Carryover</div>
          </div>
        </div>
        <span class="bank-pill bank-sbi-credit-card">Credit Bill</span>
      </div>

      <!-- Slice Savings Account -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:#4FD1C5"></span>
          <div>
            <div style="font-size:13.5px;font-weight:600;color:var(--text)">Slice Savings Account</div>
            <div style="font-size:11.5px;color:var(--text3)">Savings Account / UPI · Direct Bank Outflow (Not in Credit Bill)</div>
          </div>
        </div>
        <span class="bank-pill bank-slice-savings-account">Savings / UPI</span>
      </div>

      <!-- Slice Card / Other -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:#805AD5"></span>
          <div>
            <div style="font-size:13.5px;font-weight:600;color:var(--text)">Slice / Other Cards</div>
            <div style="font-size:11.5px;color:var(--text3)">Regular Expenses (Not counted in Credit Card Tracking)</div>
          </div>
        </div>
        <span class="bank-pill bank-slice">Regular Expense</span>
      </div>

      <!-- SBI Savings Account -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:#3B82F6"></span>
          <div>
            <div style="font-size:13.5px;font-weight:600;color:var(--text)">SBI Savings Account</div>
            <div style="font-size:11.5px;color:var(--text3)">State Bank of India · Direct Balance Expense</div>
          </div>
        </div>
        <span class="bank-pill bank-sbi-savings-account">Savings / UPI</span>
      </div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-primary-sm" id="btn-settings-view-cards" type="button">💳 Open SBI Credit Card Tracker</button>
    </div>
  </div>

  <!-- Gmail Sync -->
  <div class="settings-section card">
    <div class="settings-section-title">📧 Gmail Sync (All Bank Accounts)</div>
    <p class="hint-text" style="margin-bottom:12px">Auto-import debit transaction alert emails from HDFC, SBI, ICICI, Union Bank, Slice &amp; other banks.</p>
    <label class="field-label" style="margin-bottom:4px">Track expenses from</label>
    <input type="date" id="gmail-start-date-input" class="field-input" value="${gmailStartDate}" style="max-width:200px;margin-bottom:12px">
    ${gmailConnected
      ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
           <button class="btn-primary" id="gmail-sync-btn">🔄 Sync Gmail</button>
           <button class="btn-secondary" id="gmail-disconnect-btn">Disconnect</button>
         </div>
         ${gmailLastSync ? `<div class="hint-text" style="margin-top:8px">Last synced: ${new Date(gmailLastSync * 1000).toLocaleString()}</div>` : ''}
         ${state.gmailSyncResult
           ? state.gmailSyncResult.error
             ? `<div class="sync-result sync-result-error">⚠️ ${state.gmailSyncResult.error}</div>`
             : `<div class="sync-result sync-result-ok" style="margin-top:10px">
                  ✅ Checked ${state.gmailSyncResult.checked} emails · <strong>${state.gmailSyncResult.imported}</strong> imported
                  ${state.gmailSyncResult.rows?.length ? `
                  <div class="gmail-result-list">
                    ${state.gmailSyncResult.rows.map(r => {
                      const icons = { imported:'✅', dupe:'⏭️', credit:'⏭️', failed:'❌', pending:'🔄', before_start:'⏭️', skipped_by_user:'⏭️' };
                      const labels = {
                        imported: `Imported [${r.bank||'Bank'}] ${r.type === 'credit' ? '(Credit) ' : ''}₹${r.amount} ${r.type === 'credit' ? 'from' : 'to'} ${r.merchant}`,
                        dupe: `Skipped [${r.bank||'Bank'}]: already imported`,
                        credit: `Skipped [${r.bank||'Bank'}]: credit transaction`,
                        before_start: `Skipped [${r.bank||'Bank'}]: before start date`,
                        skipped_by_user: 'Skipped by you',
                        pending: `Pending [${r.bank||'Bank'}] ${r.type === 'credit' ? '(Credit) ' : ''}₹${r.amount} ${r.type === 'credit' ? 'from' : 'to'} ${r.merchant}`,
                        failed: `FAILED to parse [${r.bank||'Bank'}] — <code style="font-size:10px;word-break:break-all">${(r.snippet||'').replace(/</g,'&lt;')}</code>`
                      };
                      return `<div class="gmail-result-row gmail-result-${r.status}">
                        <span class="gmail-result-icon">${icons[r.status]||'•'}</span>
                        <span class="gmail-result-date">${r.date}</span>
                        <span class="gmail-result-label">${labels[r.status]||r.status}</span>
                      </div>`;
                    }).join('')}
                  </div>` : ''}
                </div>`
           : ''}`
      : `<button class="btn-primary" id="gmail-connect-btn">📧 Connect Gmail</button>
         <p class="hint-text" style="margin-top:8px">Connect your Google account to auto-import debit transaction alert emails from HDFC, SBI, ICICI, Union Bank of India, Slice, and all your bank accounts.</p>`
    }

    <!-- Gemini AI Fallback -->
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-weight:600;font-size:13px;margin-bottom:4px">🤖 Gemini AI Parsing (Optional)</div>
      <p class="hint-text" style="margin-bottom:8px">Add a Google Gemini API Key to enable AI-powered fallback for unformatted alerts or unusual merchant names.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="password" id="gemini-api-key-input" class="field-input" placeholder="AIzaSy..." value="${geminiApiKey}" style="flex:1;min-width:180px;font-family:monospace;font-size:12px">
        <button class="btn-secondary" id="gemini-api-key-save-btn" style="white-space:nowrap">Save Key</button>
      </div>
    </div>
  </div>

  <!-- Categories -->
  <div class="settings-section card">
    <div class="settings-section-title">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
        <line x1="7" y1="7" x2="7.01" y2="7"/>
      </svg>
      Categories
    </div>
    <p class="hint-text" style="margin-bottom:12px">Manage your categories. Each category appears as a compact tag below.</p>
    
    <div id="cat-settings-list">
      ${state.categories.map(cat => `
        <div class="cat-setting-row" data-cat-id="${cat.id}">
          <span class="cat-setting-icon">${getCatBadge(cat, 14)}</span>
          <span class="cat-setting-name">${cat.name}</span>
          ${cat.id !== 'other' ? `<button type="button" class="cat-setting-del" data-cat-id="${cat.id}" title="Delete ${cat.name}">✕</button>` : ''}
        </div>
      `).join('')}
    </div>

    <!-- Inline Add Category Form -->
    <form id="inline-add-cat-form" class="inline-add-cat-form">
      <div class="inline-cat-input-wrap">
        <button type="button" id="inline-cat-emoji-btn" class="inline-cat-emoji-btn" title="Choose Icon">
          <span id="inline-cat-emoji-val">🏷️</span>
        </button>
        <input type="text" id="inline-cat-name-input" class="inline-cat-name-input" placeholder="Add new category…" maxlength="28" required autocomplete="off">
        <label class="inline-cat-color-label" title="Pick color">
          <input type="color" id="inline-cat-color-input" value="#D99B84" class="inline-cat-color-input">
          <span id="inline-cat-color-swatch" class="inline-cat-color-swatch" style="background:#D99B84"></span>
        </label>
      </div>
      <button type="submit" class="btn-primary-sm inline-cat-submit-btn">＋ Add</button>
      <button type="button" class="btn-secondary-sm" id="open-add-cat-btn" title="Open full palette & presets">🎨 Presets</button>
    </form>

    <div id="inline-cat-emoji-popover" class="inline-cat-emoji-popover" style="display:none">
      ${CAT_EMOJI_PRESETS.map(em => `<button type="button" class="inline-emoji-opt" data-emoji="${em}">${em}</button>`).join('')}
    </div>
  </div>

  <!-- Sound Effects -->
  <div class="settings-section card">
    <div class="settings-section-title">🔊 Sound Effects</div>
    <div class="setting-row">
      <div>
        <div style="font-weight:600;margin-bottom:2px">Fairy chime sounds</div>
        <div class="hint-text">Play sounds on actions and category taps.</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="sfx-setting-toggle" ${localStorage.getItem('sfx') !== 'false' ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <!-- About -->
  <div class="settings-section card">
    <div class="settings-section-title">ℹ️ About</div>
    <p class="hint-text">Expense Tracker PWA v1.0 · Data stored on-device · No accounts</p>
  </div>
  </div><!-- /settings-grid -->
</div>
`;
}

function mountSettings() {
  // Smart categorization toggle
  document.getElementById('smart-cat-toggle')?.addEventListener('change', async e => {
    await db.setSetting('smart_categorize', e.target.checked);
    showToast(e.target.checked ? 'Smart categorization on' : 'Smart categorization off');
  });

  // Gmail start date
  document.getElementById('gmail-start-date-input')?.addEventListener('change', async e => {
    const val = e.target.value;
    if (val) { await db.setSetting('gmail_start_date', val); showToast('Start date saved'); }
  });

  // Gemini API key
  document.getElementById('gemini-api-key-save-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('gemini-api-key-input');
    const key = input ? input.value.trim() : '';
    await db.setSetting('gemini_api_key', key);
    showToast(key ? 'Gemini API key saved' : 'Gemini API key cleared', 'success');
  });

  // Gmail sync
  document.getElementById('gmail-connect-btn')?.addEventListener('click', gmailConnectClick);
  document.getElementById('gmail-sync-btn')?.addEventListener('click', gmailSyncClick);
  document.getElementById('gmail-disconnect-btn')?.addEventListener('click', async () => {
    await db.setSetting('gmail_token', null);
    await db.setSetting('gmail_token_expiry', 0);
    await db.setSetting('gmail_hint', null);
    showToast('Gmail disconnected');
    renderView();
  });

  // Cards & Accounts buttons in settings
  document.getElementById('btn-settings-view-cards')?.addEventListener('click', () => {
    setView('cards');
  });
  document.getElementById('btn-settings-manage-cards')?.addEventListener('click', () => {
    openCardManageModal();
  });

  // Sound toggle in settings
  document.getElementById('sfx-setting-toggle')?.addEventListener('change', e => {
    localStorage.setItem('sfx', String(e.target.checked));
    const btn = document.getElementById('sfx-toggle');
    if (btn) btn.textContent = e.target.checked ? '🔊' : '🔇';
  });

  // Inline Add Category Form
  document.getElementById('inline-add-cat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const nameInput = document.getElementById('inline-cat-name-input');
    const name = nameInput?.value.trim();
    if (!name) return showToast('Please enter a category name', 'error');

    if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      return showToast(`Category "${name}" already exists`, 'error');
    }

    const emoji = document.getElementById('inline-cat-emoji-val')?.textContent || '🏷️';
    const color = document.getElementById('inline-cat-color-input')?.value || '#6366f1';
    const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);

    await db.add('categories', { id, name, emoji, color });
    state.categories = await db.getAll('categories');
    showToast(`Category "${name}" added!`, 'success');
    renderView();
  });

  // Emoji popover toggle & selection
  const emojiBtn = document.getElementById('inline-cat-emoji-btn');
  const emojiPopover = document.getElementById('inline-cat-emoji-popover');
  emojiBtn?.addEventListener('click', () => {
    if (emojiPopover) {
      emojiPopover.style.display = emojiPopover.style.display === 'none' ? 'flex' : 'none';
    }
  });

  document.querySelectorAll('.inline-emoji-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const emojiVal = document.getElementById('inline-cat-emoji-val');
      if (emojiVal) emojiVal.textContent = btn.dataset.emoji;
      if (emojiPopover) emojiPopover.style.display = 'none';
    });
  });

  // Live color swatch update
  const colorInput = document.getElementById('inline-cat-color-input');
  const colorSwatch = document.getElementById('inline-cat-color-swatch');
  colorInput?.addEventListener('input', e => {
    if (colorSwatch) colorSwatch.style.background = e.target.value;
  });

  // Open full add-category modal / presets
  document.getElementById('open-add-cat-btn')?.addEventListener('click', () => openAddCategoryModal());

  // Delete category buttons
  document.querySelectorAll('.cat-setting-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catId = btn.dataset.catId;
      const cat = state.categories.find(c => c.id === catId);
      if (!cat) return;
      if (!confirm(`Delete "${cat.name}"? Existing expenses in this category will be moved to Other.`)) return;
      // Re-assign expenses to 'other'
      const all = await db.getAll('expenses');
      for (const e of all.filter(e => e.category === catId)) {
        await db.put('expenses', { ...e, category: 'other' });
      }
      await db.delete('categories', catId);
      state.categories = await db.getAll('categories');
      showToast(`${cat.name} deleted`);
      renderView();
    });
  });

  document.getElementById('cat-add-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('cat-add-modal');
  });
}

// ─── Add Category Modal ───────────────────────────────────────────────────────
function openAddCategoryModal() {
  const firstEmoji = CAT_EMOJI_PRESETS[0];
  const firstColor = CAT_COLOR_PRESETS[0];

  const emojiGrid = CAT_EMOJI_PRESETS.map((em, i) =>
    `<button type="button" class="emoji-preset-btn${i === 0 ? ' selected' : ''}" data-emoji="${em}">${em}</button>`
  ).join('');

  const colorGrid = CAT_COLOR_PRESETS.map((c, i) =>
    `<button type="button" class="color-swatch${i === 0 ? ' selected' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`
  ).join('');

  document.getElementById('cat-add-modal-body').innerHTML = `
<div style="padding-top:4px">
  <div class="add-header" style="margin-bottom:18px">
    <button class="modal-close-btn" id="close-cat-add-modal" type="button">✕</button>
    <h2 style="font-size:20px;font-weight:800;letter-spacing:-0.4px;flex:1;text-align:center">New Category</h2>
    <span style="width:32px"></span>
  </div>

  <div id="cat-preview" style="display:flex;align-items:center;gap:14px;background:var(--surface2);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:20px">
    <div id="cat-preview-icon" style="width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:26px;background:${firstColor}22;flex-shrink:0">${firstEmoji}</div>
    <div>
      <div id="cat-preview-name" style="font-size:16px;font-weight:700;color:var(--text)">Category Name</div>
      <div style="font-size:12px;color:var(--text3);margin-top:2px">Preview</div>
    </div>
  </div>

  <label class="field-label">Name</label>
  <input type="text" id="new-cat-name" class="field-input" placeholder="e.g. Dining Out, Gym…" maxlength="32" autocomplete="off">

  <label class="field-label">Icon</label>
  <div class="emoji-presets">${emojiGrid}</div>

  <label class="field-label">Colour</label>
  <div class="color-swatches">${colorGrid}</div>

  <button class="btn-primary" id="save-cat-btn" type="button">＋ Add Category</button>
</div>
`;

  openModal('cat-add-modal');

  let selectedEmoji = firstEmoji;
  let selectedColor = firstColor;

  const updatePreview = () => {
    document.getElementById('cat-preview-icon').style.background = selectedColor + '22';
    document.getElementById('cat-preview-icon').textContent = selectedEmoji;
    const name = document.getElementById('new-cat-name').value.trim();
    document.getElementById('cat-preview-name').textContent = name || 'Category Name';
  };

  document.getElementById('new-cat-name')?.addEventListener('input', updatePreview);

  document.getElementById('close-cat-add-modal')?.addEventListener('click', () => closeModal('cat-add-modal'));

  document.querySelectorAll('#cat-add-modal-body .emoji-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cat-add-modal-body .emoji-preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedEmoji = btn.dataset.emoji;
      updatePreview();
    });
  });

  document.querySelectorAll('#cat-add-modal-body .color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#cat-add-modal-body .color-swatch').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedColor = btn.dataset.color;
      updatePreview();
    });
  });

  document.getElementById('save-cat-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('new-cat-name').value.trim();
    if (!name) { showToast('Enter a category name', 'error'); return; }
    // Generate a unique ID from name
    const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
    await db.add('categories', { id, name, emoji: selectedEmoji, color: selectedColor });
    state.categories = await db.getAll('categories');
    closeModal('cat-add-modal');
    showToast(`${selectedEmoji} ${name} added!`);
    renderView();
  });
}

// ─── Excel / CSV Import ──────────────────────────────────────────────────────

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Failed to load SheetJS'));
    document.head.appendChild(s);
  });
}

function parseDateValue(val) {
  if (!val) return today();
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return today();
}

function autoMapColumns(headers) {
  const dateKw    = ['date','transaction date','txn date','value date','posting date','trans date'];
  const amountKw  = ['amount','debit','dr','withdrawal','transaction amount','txn amount','spent','price','total'];
  const merchantKw= ['description','merchant','narration','particulars','payee','details','remark','remarks','note','notes','vendor'];
  const categoryKw= ['category','type','label'];
  const methodKw  = ['mode','method','payment mode','payment method','channel'];

  const find = (kws) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().trim();
      if (kws.includes(h)) return i;
    }
    // partial match fallback
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().trim();
      if (kws.some(k => h.includes(k) || k.includes(h))) return i;
    }
    return -1;
  };

  return {
    dateCol:     find(dateKw),
    amountCol:   find(amountKw),
    merchantCol: find(merchantKw),
    categoryCol: find(categoryKw),
    methodCol:   find(methodKw),
  };
}

function autoCategoriseImport(merchantName, categories) {
  const lower = (merchantName || '').toLowerCase();
  const catKeywords = {
    food:          ['food','restaurant','cafe','swiggy','zomato','domino','pizza','burger','kfc','mcdonald','starbucks','coffee','eat','dining','lunch','dinner','breakfast','biryani','hotel'],
    transport:     ['ola','uber','auto','taxi','metro','bus','train','rapido','petrol','fuel','gas','cab','travel','flight','irctc'],
    shopping:      ['amazon','flipkart','myntra','ajio','nykaa','shop','store','mart','mall','cloth','fashion','zara'],
    entertainment: ['netflix','spotify','prime','hotstar','movie','cinema','pvr','inox','game','youtube'],
    health:        ['pharmacy','medical','hospital','clinic','doctor','medicine','health','apollo','diagnostic','lab'],
    utilities:     ['electricity','water','internet','broadband','jio','airtel','vi','bsnl','recharge','bill','utility'],
    grocery:       ['grofer','bigbasket','dmart','grocery','supermarket','blinkit','zepto','instamart','vegetable','fruit'],
  };
  for (const [catId, keywords] of Object.entries(catKeywords)) {
    if (keywords.some(k => lower.includes(k))) {
      const match = categories.find(c => c.id === catId || c.name.toLowerCase().includes(catId));
      if (match) return match.id;
    }
  }
  return categories[0]?.id || 'other';
}

async function openImportModal() {
  const categories = await db.getAll('categories');
  const userEmail = await db.getSetting('gmail_user_email', '');
  const gmailConnected = !!userEmail;

  document.getElementById('import-modal-body').innerHTML = `
    <div class="import-wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h2 class="modal-title" style="margin:0">📥 Import & Parse Bank Data</h2>
        <button class="modal-close-btn" id="close-import-modal" title="Close" type="button">✕</button>
      </div>

      <!-- Tab Navigation -->
      <div class="segmented-control" id="import-tabs" style="margin-bottom:18px">
        <button type="button" class="segmented-btn active" data-tab="tab-alert-parser">💬 Paste Bank Alert / SMS</button>
        <button type="button" class="segmented-btn" data-tab="tab-gmail-sync">✉️ Gmail Auto-Sync</button>
        <button type="button" class="segmented-btn" data-tab="tab-file-import">📊 Excel / CSV File</button>
      </div>

      <!-- TAB 1: Bank Alert / SMS Parser -->
      <div id="tab-alert-parser" class="import-tab-content">
        <p class="import-hint" style="margin-bottom:12px">
          Paste any Indian bank transaction alert SMS, email body, or push notification. Our multi-bank parser automatically detects Debit vs Credit, payment method (UPI/Card/Transfer), and cleans up merchant names.
        </p>

        <textarea id="parse-alert-input" class="field-input" rows="4" style="width:100%;resize:vertical;font-family:monospace;font-size:12.5px" placeholder="Paste bank alert here, e.g.:
HDFC Bank: Rs 780.00 debited from a/c **4120 on 14-03-26 towards SWIGGY via UPI/507421894982...
Or: Axis Bank: INR 2,450.00 credited to A/C ending 9876 via IMPS from RAJESH..."></textarea>

        <div style="display:flex;gap:8px;margin-top:10px">
          <button type="button" class="btn-primary" id="btn-run-parse-alert" style="flex:1">
            ⚡ Parse Alert
          </button>
          <button type="button" class="btn-secondary" id="btn-clear-parse-alert">
            Clear
          </button>
        </div>

        <!-- Parsed Result Card -->
        <div id="parsed-alert-card" style="display:none;margin-top:16px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Extracted Transaction</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div>
              <span id="parsed-badge-type" class="direction-badge direction-debit">Debit</span>
              <span id="parsed-badge-method" class="method-tag" style="margin-left:4px">UPI</span>
              <span id="parsed-badge-bank" style="font-size:11px;color:var(--text3);margin-left:6px"></span>
            </div>
            <div id="parsed-amount" style="font-size:18px;font-weight:700;color:var(--text)">₹0.00</div>
          </div>
          <div style="font-size:13.5px;font-weight:600;color:var(--text);margin-bottom:2px" id="parsed-merchant"></div>
          <div style="font-size:11.5px;color:var(--text3);margin-bottom:12px" id="parsed-meta"></div>

          <div style="display:flex;gap:8px">
            <button type="button" class="btn-primary" id="btn-save-parsed-alert" style="flex:1">
              ✓ Save to Transactions
            </button>
            <button type="button" class="btn-secondary" id="btn-edit-parsed-alert">
              Edit First
            </button>
          </div>
        </div>
      </div>

      <!-- TAB 2: Gmail Auto-Sync -->
      <div id="tab-gmail-sync" class="import-tab-content" style="display:none">
        <p class="import-hint" style="margin-bottom:14px">
          Connect your Gmail to automatically fetch and parse transaction alert emails across all Indian banks (HDFC, ICICI, SBI, Axis, Kotak, etc.).
        </p>

        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:24px">✉️</span>
              <div>
                <div style="font-weight:600;font-size:14px">Google Account</div>
                <div style="font-size:12px;color:var(--text3)">${gmailConnected ? `Connected as ${userEmail}` : 'Not connected'}</div>
              </div>
            </div>
            <button class="${gmailConnected ? 'btn-secondary' : 'btn-primary'}" id="btn-modal-gmail-connect">
              ${gmailConnected ? 'Reconnect' : 'Connect Gmail'}
            </button>
          </div>
        </div>

        <button class="btn-primary" id="btn-modal-gmail-sync" style="width:100%" ${gmailConnected ? '' : 'disabled'}>
          🔄 Sync Transactions Now
        </button>
        <div id="modal-gmail-status" style="margin-top:12px;font-size:12px;color:var(--text3);text-align:center"></div>
      </div>

      <!-- TAB 3: Excel / CSV File -->
      <div id="tab-file-import" class="import-tab-content" style="display:none">
        <p class="import-hint">Upload a bank statement spreadsheet (.xlsx, .xls, .csv). The app will auto-detect columns and map dates, merchants, and amounts.</p>
        <div class="import-drop-zone" id="import-drop-zone">
          <div class="import-drop-icon">📂</div>
          <div class="import-drop-label">Drop file here or <label class="import-file-label" for="import-file-input">browse</label></div>
          <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv" style="display:none">
          <div class="import-drop-sub">Supports .xlsx, .xls, .csv statements</div>
        </div>
        <div id="import-status" style="display:none;text-align:center;padding:16px;color:var(--text3)">Parsing file…</div>
        <div id="import-preview-wrap" style="display:none"></div>
      </div>
    </div>`;

  openModal('import-modal');

  // Close button
  document.getElementById('close-import-modal')?.addEventListener('click', () => closeModal('import-modal'));

  // Tab switching
  const tabs = document.querySelectorAll('#import-tabs .segmented-btn');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('.import-tab-content').forEach(c => c.style.display = 'none');
      const target = document.getElementById(t.dataset.tab);
      if (target) target.style.display = 'block';
    });
  });

  // Tab 1: Parse Alert
  let lastParsedTxn = null;
  const parseInput = document.getElementById('parse-alert-input');
  const alertCard = document.getElementById('parsed-alert-card');

  document.getElementById('btn-clear-parse-alert')?.addEventListener('click', () => {
    if (parseInput) parseInput.value = '';
    if (alertCard) alertCard.style.display = 'none';
    lastParsedTxn = null;
  });

  document.getElementById('btn-run-parse-alert')?.addEventListener('click', async () => {
    const rawText = parseInput?.value?.trim();
    if (!rawText) return showToast('Please paste a transaction alert', 'error');

    const geminiKey = await db.getSetting('gemini_api_key', '');
    const result = await parseBankEmail(rawText, Date.now(), '', '', geminiKey);

    if (!result || !result.amount) {
      return showToast('Could not extract a valid amount from this text', 'error');
    }

    lastParsedTxn = result;
    alertCard.style.display = 'block';

    const isCredit = result.type === 'credit';
    const typeBadge = document.getElementById('parsed-badge-type');
    typeBadge.className = `direction-badge direction-${isCredit ? 'credit' : 'debit'}`;
    typeBadge.textContent = isCredit ? 'Credit' : 'Debit';

    document.getElementById('parsed-badge-method').textContent = result.method || 'UPI';
    document.getElementById('parsed-badge-bank').textContent = result.bank ? `(${result.bank})` : '';

    const amtEl = document.getElementById('parsed-amount');
    amtEl.textContent = (isCredit ? '+' : '-') + fmtCurrency(result.amount, true);
    amtEl.style.color = isCredit ? 'var(--income)' : 'var(--text)';

    document.getElementById('parsed-merchant').textContent = result.merchant || 'Unknown Merchant';
    document.getElementById('parsed-meta').textContent = `Date: ${result.date}${result.time ? ` · ${result.time}` : ''}${result.refNo ? ` · Ref: ${result.refNo}` : ''}`;
  });

  document.getElementById('btn-save-parsed-alert')?.addEventListener('click', async () => {
    if (!lastParsedTxn) return;
    const catGuess = await autoCategory(lastParsedTxn.merchant);
    await db.add('expenses', {
      amount: lastParsedTxn.amount,
      merchant: lastParsedTxn.merchant,
      date: lastParsedTxn.date || today(),
      time: lastParsedTxn.time || '',
      month: dateToMonth(lastParsedTxn.date || today()),
      method: lastParsedTxn.method || 'UPI',
      type: lastParsedTxn.type || 'debit',
      category: catGuess.categoryId || 'other',
      note: lastParsedTxn.refNo ? `Ref: ${lastParsedTxn.refNo}` : '',
      createdAt: Date.now()
    });
    gistSync();
    playAdd();
    showToast(`Added ${lastParsedTxn.merchant || 'transaction'} (${fmtCurrency(lastParsedTxn.amount)})`);
    closeModal('import-modal');
    renderView();
  });

  document.getElementById('btn-edit-parsed-alert')?.addEventListener('click', () => {
    if (!lastParsedTxn) return;
    closeModal('import-modal');
    openAddModal({
      amount: lastParsedTxn.amount,
      merchant: lastParsedTxn.merchant,
      date: lastParsedTxn.date || today(),
      time: lastParsedTxn.time || '',
      method: lastParsedTxn.method || 'UPI',
      type: lastParsedTxn.type || 'debit',
      note: lastParsedTxn.refNo ? `Ref: ${lastParsedTxn.refNo}` : ''
    });
  });

  // Tab 2: Gmail
  document.getElementById('btn-modal-gmail-connect')?.addEventListener('click', () => {
    gmailConnect();
  });
  document.getElementById('btn-modal-gmail-sync')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('modal-gmail-status');
    if (statusEl) statusEl.textContent = 'Syncing bank emails…';
    await gmailDoSync(false);
    if (statusEl) statusEl.textContent = 'Sync complete!';
  });

  // Tab 3: File input & Drag-and-drop
  document.getElementById('import-file-input')?.addEventListener('change', e => {
    if (e.target.files[0]) handleImportFile(e.target.files[0], categories);
  });

  const dz = document.getElementById('import-drop-zone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0], categories);
    });
    dz.addEventListener('click', () => document.getElementById('import-file-input')?.click());
  }
}

async function handleImportFile(file, categories) {
  const statusEl = document.getElementById('import-status');
  const previewWrap = document.getElementById('import-preview-wrap');
  const dropZone = document.getElementById('import-drop-zone');

  statusEl.style.display = 'block';
  statusEl.textContent = 'Loading parser…';

  try {
    const XLSX = await loadXLSX();
    statusEl.textContent = 'Parsing file…';

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) {
      statusEl.textContent = '⚠️ File appears to be empty or has only one row.';
      return;
    }

    // Find header row: first row with >= 2 non-empty cells
    let headerIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const nonEmpty = rows[i].filter(c => String(c).trim() !== '').length;
      if (nonEmpty >= 2) { headerIdx = i; break; }
    }
    const headers = rows[headerIdx];
    const map = autoMapColumns(headers);

    // Parse data rows
    const parsedRows = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const rawAmount = map.amountCol >= 0 ? row[map.amountCol] : '';
      const amount = Math.abs(parseFloat(String(rawAmount).replace(/[^\d.-]/g, '')) || 0);
      if (!amount || isNaN(amount)) continue;

      const merchant = map.merchantCol >= 0 ? String(row[map.merchantCol] || '').trim() : '';
      const rawDate = map.dateCol >= 0 ? row[map.dateCol] : '';
      const date = parseDateValue(rawDate);
      const method = map.methodCol >= 0 ? String(row[map.methodCol] || '').trim() : 'Other';
      const catGuess = map.categoryCol >= 0 && String(row[map.categoryCol] || '').trim()
        ? (categories.find(c => c.name.toLowerCase() === String(row[map.categoryCol]).toLowerCase())?.id || autoCategoriseImport(merchant, categories))
        : autoCategoriseImport(merchant, categories);

      parsedRows.push({ date, merchant, amount, category: catGuess, method: method || 'Other', type: 'debit' });
    }

    if (parsedRows.length === 0) {
      statusEl.textContent = '⚠️ No valid expense rows found. Make sure the file has a Date and Amount column.';
      return;
    }

    statusEl.style.display = 'none';
    dropZone.style.display = 'none';

    previewWrap.style.display = 'block';
    previewWrap.innerHTML = `
      <div class="import-preview">
        <div class="import-preview-header">
          <span class="import-count">Found <strong>${parsedRows.length}</strong> transactions</span>
          <div class="import-actions">
            <button class="btn-secondary" id="import-cancel-btn">Cancel</button>
            <button class="btn-primary" id="import-confirm-btn">Import ${parsedRows.length} expenses →</button>
          </div>
        </div>
        <div class="import-table-wrap">
          <table class="txn-table import-table">
            <thead>
              <tr>
                <th class="txn-th">Date</th>
                <th class="txn-th">Merchant</th>
                <th class="txn-th">Amount (₹)</th>
                <th class="txn-th">Category</th>
                <th class="txn-th">Method</th>
                <th class="txn-th" title="Check to skip this row">Skip</th>
              </tr>
            </thead>
            <tbody>
              ${parsedRows.map((r, i) => `
                <tr class="import-row txn-row" data-i="${i}">
                  <td class="txn-td"><input class="import-cell-input" data-field="date" data-i="${i}" value="${r.date}"></td>
                  <td class="txn-td"><input class="import-cell-input" data-field="merchant" data-i="${i}" value="${r.merchant}"></td>
                  <td class="txn-td"><input class="import-cell-input import-amount" data-field="amount" data-i="${i}" value="${r.amount}" type="number" min="0" step="0.01"></td>
                  <td class="txn-td">
                    <select class="import-cell-select" data-field="category" data-i="${i}">
                      ${categories.map(c => `<option value="${c.id}" ${c.id === r.category ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('')}
                    </select>
                  </td>
                  <td class="txn-td">
                    <select class="import-cell-select" data-field="method" data-i="${i}">
                      ${['UPI','Card','Cash','NetBanking','Other'].map(m => `<option value="${m}" ${m === r.method ? 'selected' : ''}>${m}</option>`).join('')}
                    </select>
                  </td>
                  <td class="txn-td" style="text-align:center">
                    <input type="checkbox" class="import-skip" data-i="${i}">
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    previewWrap.querySelectorAll('.import-skip').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = previewWrap.querySelector(`.import-row[data-i="${cb.dataset.i}"]`);
        if (row) row.classList.toggle('skipped', cb.checked);
      });
    });

    document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
      closeModal('import-modal');
    });

    document.getElementById('import-confirm-btn')?.addEventListener('click', () => {
      importConfirmed(parsedRows, previewWrap);
    });

  } catch (err) {
    statusEl.textContent = `⚠️ Error: ${err.message}`;
  }
}

async function importConfirmed(parsedRows, previewWrap) {
  const rows = previewWrap.querySelectorAll('.import-row');
  let count = 0;
  for (const row of rows) {
    const skipCb = row.querySelector('.import-skip');
    if (skipCb?.checked) continue;

    const i = parseInt(row.dataset.i);
    const dateVal  = row.querySelector('[data-field="date"]')?.value || parsedRows[i].date;
    const merchant = row.querySelector('[data-field="merchant"]')?.value.trim() || parsedRows[i].merchant;
    const amount   = parseFloat(row.querySelector('[data-field="amount"]')?.value) || parsedRows[i].amount;
    const category = row.querySelector('[data-field="category"]')?.value || parsedRows[i].category;
    const method   = row.querySelector('[data-field="method"]')?.value || parsedRows[i].method;

    if (!amount || isNaN(amount)) continue;

    const date = parseDateValue(dateVal);
    await db.add('expenses', {
      date,
      month: date.slice(0, 7),
      merchant,
      amount,
      category,
      method,
      type: 'debit',
      note: '',
      createdAt: Date.now(),
    });
    count++;
  }

  gistSync();
  closeModal('import-modal');
  renderView();
  showToast(`Imported ${count} transaction${count !== 1 ? 's' : ''}`);
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

  // Auto-sync Gmail silently on startup if token is valid
  getGmailToken().then(t => { if (t) gmailDoSync(true); });

  // Sidebar toggle (desktop collapse + mobile drawer slide-over)
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');

  // Restore saved desktop collapse preference
  if (state.sidebarCollapsed && window.innerWidth > 900) {
    sidebar?.classList.add('collapsed');
  }

  const toggleSidebar = () => {
    if (window.innerWidth <= 900) {
      const isOpen = sidebar?.classList.toggle('drawer-open');
      backdrop?.classList.toggle('active', isOpen);
    } else {
      const isCollapsed = sidebar?.classList.toggle('collapsed');
      state.sidebarCollapsed = !!isCollapsed;
      localStorage.setItem('sidebar_collapsed', state.sidebarCollapsed);
    }
  };

  toggleBtn?.addEventListener('click', toggleSidebar);
  collapseBtn?.addEventListener('click', toggleSidebar);
  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('drawer-open');
    backdrop?.classList.remove('active');
  });

  // Header month navigation
  document.getElementById('header-prev-month')?.addEventListener('click', () => {
    const [y, m] = state.currentMonth.split('-').map(Number);
    let nm = m - 1, ny = y;
    if (nm < 1) { nm = 12; ny--; }
    state.currentMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    renderView();
  });

  document.getElementById('header-next-month')?.addEventListener('click', () => {
    const [y, m] = state.currentMonth.split('-').map(Number);
    let nm = m + 1, ny = y;
    if (nm > 12) { nm = 1; ny++; }
    state.currentMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    renderView();
  });

  document.getElementById('header-today-btn')?.addEventListener('click', () => {
    state.currentMonth = today().slice(0, 7);
    renderView();
  });

  // Header & sidebar quick buttons
  document.getElementById('header-add-btn')?.addEventListener('click', () => openAddModal());
  document.getElementById('sidebar-add-btn')?.addEventListener('click', () => openAddModal());
  document.getElementById('mobile-quick-add')?.addEventListener('click', () => openAddModal());
  document.getElementById('header-import-btn')?.addEventListener('click', () => openImportModal());
  document.getElementById('open-import-sidebar')?.addEventListener('click', () => openImportModal());

  // Gmail Sync quick actions (in Header & Expense Tracker Sidebar)
  const triggerGmailSyncAction = async () => {
    const token = await getGmailToken();
    if (!token) {
      gmailConnectClick();
    } else {
      gmailSyncClick();
    }
  };
  document.getElementById('header-gmail-sync-btn')?.addEventListener('click', triggerGmailSyncAction);
  document.getElementById('sidebar-sync-gmail-btn')?.addEventListener('click', triggerGmailSyncAction);

  // Gatekeeper backdrop click handler
  const gkModal = document.getElementById('gatekeeper-modal');
  gkModal?.addEventListener('click', e => {
    if (e.target === gkModal) closeModal('gatekeeper-modal');
  });

  // Initialize Gatekeeper module
  initGatekeeper({
    categories: state.categories,
    showToast,
    openModal,
    closeModal,
    fmt,
    today,
    renderView,
    gistSync
  });
  updateGatekeeperBadge();

  // Nav clicks
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const v = el.dataset.view;
      if (!v) return;
      if (v === 'add') { openAddModal(); return; }
      setView(v);
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const addModalOpen = document.getElementById('add-modal')?.classList.contains('open');
    const importModalOpen = document.getElementById('import-modal')?.classList.contains('open');

    // N: New transaction
    if ((e.key === 'n' || e.key === 'N') && !inInput && !e.ctrlKey && !e.metaKey && !addModalOpen && !importModalOpen) {
      e.preventDefault();
      openAddModal();
    }

    // [ or Ctrl+B / Cmd+B: Toggle sidebar
    if (((e.key === '[' && !inInput) || ((e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey))) && !addModalOpen) {
      e.preventDefault();
      toggleSidebar();
    }

    // Escape: Close modal
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // Close modals on back gesture (popstate)
  window.addEventListener('popstate', closeAllModals);

  // SFX toggle
  const sfxBtn = document.getElementById('sfx-toggle');
  if (sfxBtn) {
    const updateSfxBtn = () => {
      sfxBtn.textContent = localStorage.getItem('sfx') === 'false' ? '🔇' : '🔊';
    };
    updateSfxBtn();
    sfxBtn.addEventListener('click', () => { toggleSound(); updateSfxBtn(); });
  }

  // Custom cursor (desktop / pointer:fine only)
  initCustomCursor();

  // Initial render
  renderView();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
