import { db } from './db.js';
import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES } from './categories.js';
import { playAdd, playDelete, playNav, playBudgetWarn, toggleSound, playCategorySound } from './audio.js';

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
  budgetChart: null,
  storagePersisted: null,    // null=unknown, true=safe, false=at-risk
  sortCol: 'date',
  sortDir: 'desc',
  gmailSyncResult: null,
  gmailPendingImport: [],
  sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true',
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
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();
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

  // If plain text has clear transaction details, use it
  if (plainCombined && isTxn(plainCombined) && plainCombined.length > 35) {
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

function normalizeDate(rawDate, fallbackDateMs) {
  if (!rawDate) {
    return new Date(fallbackDateMs || Date.now()).toISOString().slice(0, 10);
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
  return new Date(fallbackDateMs || Date.now()).toISOString().slice(0, 10);
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

const MERCHANT_STOPWORDS = new Set([
  'inform', 'inform you', 'inform you that', 'inform you that rs',
  'you', 'your', 'your account', 'your a/c', 'account', 'a/c',
  'bank', 'bank account', 'card', 'credit card', 'debit card',
  'customer', 'dear customer', 'slice', 'slice debit', 'hdfc debit', 'sbi debit',
  'upi', 'vpa', 'not', 'our', 'the', 'this', 'that', 'view', 'check',
  'call', 'contact', 'sms', 'otp', 'ref', 'reference', 'avl', 'bal',
  'available balance', 'total', 'amount', 'transaction', 'alert', 'update',
  'online', 'payment', 'successful', 'completed', 'using', 'towards', 'unknown merchant'
]);

function stripBoilerplate(text) {
  let cleaned = text;
  for (const bp of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(bp, ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

function cleanUpiHandle(handle) {
  if (!handle) return '';
  let name = handle.split('@')[0];
  name = name.replace(/[-_.][0-9]+$/g, '');
  name = name.replace(/[0-9]+$/g, '');
  name = name.replace(/[._\-]/g, ' ').trim();
  return name.split(' ')
    .filter(w => w.length > 0 && !/^(rzp|paytm|qr|vpa|upi)$/i.test(w))
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function cleanMerchantName(str) {
  if (!str) return '';
  let cleaned = str
    .replace(/^[@\-_.:\s"'“”‘’]+|[@\-_.:\s"'“”‘’]+$/g, '')
    .replace(/^(?:vpa|to|towards|at|paid\s+to|transfer\s+to|sent\s+to|refund\s+from|cashback\s+from|received\s+from)\s+/i, '')
    .replace(/\s+(?:on|using|via|ref|upi|date)\b.*$/i, '')
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
  if (/^(?:inform|view|notify|check|call|your|our|the|this|that|please|an?\s+amount)\b/i.test(cleaned)) {
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
  if (/upi|vpa|@ok[a-z]+|@okhdfcbank|@okaxis|@oksbi|@ybl|@paytm|@ibl|@axl|@apl|@upi|upi\/p2m|upi\/p2a|upi\s*ref/i.test(body)) {
    return 'UPI';
  }
  if (/neft|imps|rtgs|netbanking|internet\s+banking|funds?\s+transfer|\binb\b/i.test(body)) {
    return 'Transfer';
  }
  if (/credit\s*card|debit\s*card|card\s+ending|\bpos\b|\becom\b|spent\s+on\s+your\s+.*?card/i.test(body)) {
    return 'Card';
  }
  if (/atm|cash\s+withdrawal/i.test(body)) {
    return 'Cash';
  }
  if (/slice/i.test(bank)) {
    return 'Card';
  }
  return 'UPI';
}

function extractMerchantFromText(body, strippedBody, bank = '') {
  // 1. Bracket inside VPA: VPA handle (Merchant Name)
  const vpaBracket = body.match(/VPA\s+\S+\s*\(([^)]+)\)/i);
  if (vpaBracket) {
    const candidate = cleanMerchantName(vpaBracket[1]);
    if (candidate) return candidate;
  }

  // 2. UPI Info line: Info: UPI/12345/Merchant/Bank or towards UPI/12345/Merchant
  const infoMatch = body.match(/(?:Info:\s*|towards\s+)?UPI\/\d+\/([^\/]+)(?:\/|$)/i);
  if (infoMatch) {
    const candidate = cleanMerchantName(infoMatch[1]);
    if (candidate) return candidate;
  }

  // 3. Payment of Rs X to <Merchant> was successful / completed
  const paySuccessMatch = strippedBody.match(/payment\s+of\s+[^.]+?\bto\s+([A-Za-z0-9 &.'\-@]{2,50}?)\s+(?:was\s+successful|successful|completed)/i);
  if (paySuccessMatch) {
    const candidate = cleanMerchantName(paySuccessMatch[1]);
    if (candidate) return candidate;
  }

  // 4. "at <Merchant> using slice" or "at <Merchant> on..."
  const atMatch = strippedBody.match(/\bat\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+using|\s+on\b|\s+via|\.\s+|\n|$|Rs|INR|₹)/i);
  if (atMatch) {
    const candidate = cleanMerchantName(atMatch[1]);
    if (candidate) return candidate;
  }

  // 5. For refunds / cashback / credits: "refund from <Merchant>" / "received from <Merchant>" / "towards refund from <Merchant>"
  const refundMatch = strippedBody.match(/(?:towards\s+)?(?:refund\s+from|received\s+from|cashback\s+(?:of|from))\s+([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+Ref|\s+UPI|\s+on\b|\s+via|\.\s+|\n|$)/i);
  if (refundMatch) {
    const candidate = cleanMerchantName(refundMatch[1]);
    if (candidate) return candidate;
  }

  // 6. "paid to <Merchant>" / "transfer to <Merchant>" / "towards <Merchant>" / "sent to <Merchant>" / "NEFT to <Merchant>"
  const actionMatch = strippedBody.match(/(?:paid\s+to|transfer\s+to|transferred\s+to|sent\s+to|towards|(?:NEFT|IMPS|RTGS|funds?\s+transfer)\s+(?:(?:transfer|payment)\s+)?to)\s+(?:VPA\s+)?([A-Za-z0-9 &.'\-@]{2,50}?)(?:\s+Ref|\s+UPI|\s+UTR|\s+on\b|\s+using|\s+via|\.\s+|\n|$|Rs|INR|₹)/i);
  if (actionMatch) {
    const candidate = cleanMerchantName(actionMatch[1]);
    if (candidate) return candidate;
  }

  // 7. Bare VPA handle: VPA merchant@upi
  const vpaBare = body.match(/VPA\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i);
  if (vpaBare) {
    const candidate = cleanUpiHandle(vpaBare[1]);
    if (candidate && !MERCHANT_STOPWORDS.has(candidate.toLowerCase())) return candidate;
  }

  return /atm|cash withdrawal/i.test(body) ? `${bank} ATM` : 'Unknown Merchant';
}

function detectBank(from = '', subject = '', body = '') {
  const f = (from || '').toLowerCase();
  const sub = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase();

  // 1. Check sender address first (most authoritative)
  if (f.includes('hdfc')) return 'HDFC';
  if (f.includes('sbi') || f.includes('sbicard')) return 'SBI';
  if (f.includes('icici')) return 'ICICI';
  if (f.includes('unionbank') || f.includes('ubi')) return 'Union Bank';
  if (f.includes('sliceit') || f.includes('slice')) return 'Slice';
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

  // 2. Check subject line & body
  const checkStr = (s) => {
    if (s.includes('hdfc')) return 'HDFC';
    if (s.includes('state bank') || s.includes('sbi') || s.includes('sbicard')) return 'SBI';
    if (s.includes('icici')) return 'ICICI';
    if (s.includes('union bank') || s.includes('ubi')) return 'Union Bank';
    if (s.includes('slice')) return 'Slice';
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
  const prompt = `You are a financial transaction extractor for Indian bank and payment alert emails.
Extract transaction details from this email alert. Return ONLY valid JSON with no markdown formatting.
Schema:
{
  "amount": <number>,
  "type": "debit" | "credit",
  "method": "UPI" | "Card" | "Transfer" | "Cash",
  "merchant": "<clean merchant, store, person, or organization name>",
  "refNo": "<transaction reference or UTR or null>",
  "date": "YYYY-MM-DD or null"
}

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
  const type = classifyTransactionDirection(body, subject);

  // 2. Identify Bank & Method
  const bank = detectBank(from, subject, body);
  const method = detectPaymentMethod(body, bank);

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

  // 6. Extract Date
  let date = null;
  const dateMatch = body.match(/\bon\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[- ][A-Za-z]{3}[- ]\d{2,4})/i) ||
                    body.match(/\bdate\s*:?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[- ][A-Za-z]{3}[- ]\d{2,4})/i);
  date = normalizeDate(dateMatch ? dateMatch[1] : null, emailDateMs);

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
  if (geminiApiKey && merchant === 'Unknown Merchant') {
    const llm = await callGeminiParse(body, subject, geminiApiKey);
    if (llm && llm.merchant && !MERCHANT_STOPWORDS.has(llm.merchant.toLowerCase())) {
      merchant = cleanMerchantName(llm.merchant) || merchant;
      if (llm.type) type = llm.type;
      if (llm.method) method = llm.method;
      if (llm.refNo && !refNo) refNo = llm.refNo;
    }
  }

  return { amount, merchant, date, method, refNo, bank, type };
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
      <thead><tr><th>✓</th><th>Date</th><th>Type</th><th>Bank</th><th>Merchant</th><th>Amount</th><th>Category</th><th>Method</th></tr></thead>
      <tbody>
        ${transactions.map((t, i) => `
          <tr>
            <td><input type="checkbox" class="gmail-import-check" data-i="${i}" ${t.type === 'credit' ? '' : 'checked'}></td>
            <td style="white-space:nowrap;font-size:13px;color:var(--text3)">${t.date}</td>
            <td><span class="txn-type-badge txn-type-${t.type || 'debit'}">${t.type === 'credit' ? '🟢 Credit' : '🔴 Debit'}</span></td>
            <td><span class="bank-pill bank-${(t.bank||'bank').toLowerCase().replace(/\s+/g, '-')}">${t.bank||'Bank'}</span></td>
            <td><input class="import-cell-input" data-i="${i}" data-f="merchant" value="${(t.merchant||'').replace(/"/g,'&quot;')}"></td>
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
        date: t.date, month: t.date.slice(0,7),
        merchant, amount, category, method: t.method || 'UPI',
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

  const btn = document.getElementById('gmail-sync-btn');
  if (btn && !silent) { btn.textContent = '⏳ Syncing…'; btn.disabled = true; }

  try {
    // Always scan from start date — never use last-sync as floor
    const startDate = await db.getSetting('gmail_start_date', '2026-10-07');
    const geminiApiKey = await db.getSetting('gemini_api_key', '');
    await db.setSetting('gmail_last_sync', null); // clear stale value so it never interferes
    const afterStr = startDate.replace(/-/g, '/');
    const query = `{from:hdfc from:sbi from:icici from:unionbank from:slice from:axis from:kotak debited spent deducted "debit alert" "transaction alert" "paid to" "transferred to" credited refund cashback} after:${afterStr}`;

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
      const dateStr = new Date(emailDate).toISOString().slice(0, 10);

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
        rows.push({ date: result.date, subject, status: 'dupe', bank: result.bank });
        continue;
      }

      const { categoryId } = await autoCategory(result.merchant);
      result.category = categoryId;
      toImport.push(result);
      rows.push({
        date: result.date,
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
    if (btn && !silent) { btn.textContent = '🔄 Sync Gmail'; btn.disabled = false; }
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
    const map = { dashboard: 'Dashboard', transactions: 'Transactions', budgets: 'Budgets', settings: 'Settings' };
    titleEl.textContent = map[state.view] || 'Dashboard';
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
    if (state.view !== 'budgets' && state.budgetChart && typeof state.budgetChart.destroy === 'function') {
      try { state.budgetChart.destroy(); } catch (_) {}
      state.budgetChart = null;
    }
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
    switch (state.view) {
      case 'dashboard':    main.innerHTML = await renderDashboard(); await mountDashboard(); break;
      case 'add':          main.innerHTML = renderAddForm(); mountAddForm(); break;
      case 'transactions': main.innerHTML = await renderTransactions(); mountTransactions(); break;
      case 'budgets':      main.innerHTML = await renderBudgets(); mountBudgets(); break;
      case 'settings':     main.innerHTML = await renderSettings(); mountSettings(); break;
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

  const catLegendRows = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([id, amt]) => {
      const cat = getCat(id);
      const pct = expenseTotal > 0 ? ((amt / expenseTotal) * 100).toFixed(1) : '0';
      return `
        <div class="cat-breakdown-row" data-cat="${id}" title="Click to view ${cat.name} transactions">
          <span class="cat-dot" style="background:${cat.color}"></span>
          <span class="cat-name-text" style="display:inline-flex;align-items:center;gap:6px">${getCatBadge(cat, 13)} <span>${cat.name}</span></span>
          <span class="cat-pct-pill">${pct}%</span>
          <span class="cat-amt-text">${fmtCurrency(amt, false)}</span>
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

  // Recent 5 transactions
  const recent5 = [...allExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  const recentItemsHTML = recent5.length === 0
    ? '<div class="empty-state" style="padding:28px 0"><div class="empty-icon">💳</div><div class="empty-title">No transactions yet</div><div class="empty-sub">Tap "+ Add Transaction" or "Load Sample Data" above</div></div>'
    : recent5.map(e => {
        const cat = getCat(e.category);
        const isCredit = e.type === 'credit';
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
                  <span class="method-tag" style="font-size:10px;padding:1px 5px">${e.method || 'UPI'}</span>
                  ${e.note ? `<span>· ${e.note}</span>` : ''}
                </span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <span class="direction-badge direction-${isCredit ? 'credit' : 'debit'}">${isCredit ? 'Credit' : 'Debit'}</span>
              <span class="amount-cell ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : '-'}${fmtCurrency(e.amount, true)}</span>
            </div>
          </div>
        `;
      }).join('');

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
    <!-- Category Breakdown Donut Chart -->
    <div class="dashboard-card">
      <div class="card-header-row">
        <div>
          <div class="card-heading">Category Breakdown</div>
          <div class="card-subheading">${monthLabel(month)} Spending</div>
        </div>
        <button class="btn-link" id="dash-view-all-txns-link" style="font-size:12px;font-weight:600">All Txns →</button>
      </div>

      ${debitExpenses.length === 0 ? `
        <div class="empty-state" style="padding:48px 0">
          <div class="empty-icon">📊</div>
          <div class="empty-title">No expenses in ${monthLabel(month)}</div>
          <div class="empty-sub">Tap "+ Add Transaction" or import bank emails to begin</div>
        </div>
      ` : `
        <div class="donut-layout">
          <div class="donut-canvas-wrap">
            <canvas id="donutChart"></canvas>
            <div class="donut-center-overlay">
              <span class="donut-center-label">Total</span>
              <span class="donut-center-amount">${fmtCurrency(expenseTotal, false)}</span>
            </div>
          </div>
          <div class="donut-legend-wrap" id="donut-legend-wrap">
            ${catLegendRows}
          </div>
        </div>
      `}
    </div>

    <!-- Cash Flow Bar Chart (Income vs Expense) -->
    <div class="dashboard-card">
      <div class="card-header-row">
        <div>
          <div class="card-heading">Daily Cash Flow</div>
          <div class="card-subheading">Income vs Expenses for ${monthLabel(month)}</div>
        </div>
        <div class="cashflow-legend">
          <span class="cf-badge"><span class="cf-dot income"></span> Income</span>
          <span class="cf-badge"><span class="cf-dot expense"></span> Expense</span>
        </div>
      </div>
      <div class="cashflow-chart-wrap">
        <canvas id="cashFlowChart"></canvas>
      </div>
    </div>
  </div>

  <!-- Recent Transactions Card -->
  <div class="dashboard-card" style="margin-top:20px">
    <div class="card-header-row">
      <div>
        <div class="card-heading">Recent Transactions</div>
        <div class="card-subheading">Latest recorded activity across all accounts</div>
      </div>
      <button class="btn-link" id="dash-view-all-txns" style="font-size:12px;font-weight:600">View all →</button>
    </div>
    <div class="recent-list">
      ${recentItemsHTML}
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
  renderCashFlowChart(expenses, month);

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

  // Event handlers
  document.getElementById('dash-view-all-txns')?.addEventListener('click', () => setView('transactions'));
  document.getElementById('dash-view-all-txns-link')?.addEventListener('click', () => setView('transactions'));

  // Category breakdown click -> view transactions in category
  document.querySelectorAll('.cat-breakdown-row').forEach(el => {
    el.addEventListener('click', async () => {
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
    });
  });

  document.getElementById('cat-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('cat-modal');
  });

  // Recent transactions click to edit
  document.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = parseInt(el.dataset.id);
      const expense = await db.get('expenses', id);
      if (expense) openAddModal(expense);
    });
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
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(30, 25, 27, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            titleColor: isDark ? '#F5EFEA' : '#141112',
            bodyColor: isDark ? '#D8CECA' : '#4A4042',
            padding: 10,
            cornerRadius: 8,
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
        <label class="field-label">Payment Method</label>
        <div class="method-group">${methodBtns}</div>
      </div>
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
      const merchantInput = document.getElementById('f-merchant');

      if (submitBtn) {
        submitBtn.textContent = state.editingExpense?.id
          ? 'Save Changes'
          : (selectedType === 'credit' ? '+ Add Income' : '+ Add Expense');
      }
      if (merchantLabel) {
        merchantLabel.textContent = selectedType === 'credit' ? 'Sender / Source' : 'Merchant / Payee';
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

    const expense = {
      amount,
      category: selectedCat,
      date,
      month: dateToMonth(date),
      note: document.getElementById('f-note').value.trim(),
      method: selectedMethod,
      merchant,
      type: selectedType, // 'debit' | 'credit'
      createdAt: state.editingExpense?.createdAt || Date.now(),
    };

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
      showToast(selectedType === 'credit' ? 'Income added!' : 'Expense added!');
      if (modalMode) {
        closeAddModal();
        renderView();
      } else {
        // Reset form
        document.getElementById('f-amount').value = '';
        document.getElementById('f-merchant').value = '';
        document.getElementById('f-note').value = '';
        document.getElementById('f-date').value = today();
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

  // 2. Type Filter (Debit vs Credit)
  if (state.filterType === 'debit') {
    expenses = expenses.filter(e => e.type !== 'credit');
  } else if (state.filterType === 'credit') {
    expenses = expenses.filter(e => e.type === 'credit');
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
    if (state.sortCol === 'date')          { av = a.date; bv = b.date; }
    else if (state.sortCol === 'merchant') { av = (a.merchant||'').toLowerCase(); bv = (b.merchant||'').toLowerCase(); }
    else if (state.sortCol === 'category') { av = getCat(a.category).name; bv = getCat(b.category).name; }
    else if (state.sortCol === 'amount')   { av = a.amount; bv = b.amount; }
    else if (state.sortCol === 'method')   { av = a.method||''; bv = b.method||''; }
    else                                   { av = a.date; bv = b.date; }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return state.sortDir === 'asc' ? cmp : -cmp;
  });

  // Calculate filtered totals
  const totalDebits = expenses.filter(e => e.type !== 'credit').reduce((s, e) => s + e.amount, 0);
  const totalCredits = expenses.filter(e => e.type === 'credit').reduce((s, e) => s + e.amount, 0);

  const catOptions = state.categories.map(c =>
    `<option value="${c.id}" ${state.filterCategory === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`
  ).join('');

  const tableColLabels = { date: 'Date', merchant: 'Merchant / Payee', category: 'Category', method: 'Method', type: 'Type', amount: 'Amount' };
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
            <td class="txn-td txn-date" style="white-space:nowrap">${d}</td>
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
function renderBudgetComparisonChart(monthBudgets, spentByCat) {
  const canvas = document.getElementById('budgetComparisonChart');
  if (!canvas || !window.Chart) return;

  if (state.budgetChart && typeof state.budgetChart.destroy === 'function') {
    try { state.budgetChart.destroy(); } catch (_) {}
    state.budgetChart = null;
  }

  const budgetMap = {};
  for (const b of monthBudgets) budgetMap[b.categoryId] = b.amount;

  // Union of category IDs that have budgets or expenses
  const allCatIds = Array.from(new Set([
    ...monthBudgets.map(b => b.categoryId),
    ...Object.keys(spentByCat).filter(c => spentByCat[c] > 0)
  ]));

  if (allCatIds.length === 0) return;

  // Sort categories: highest budget first, then highest spending
  allCatIds.sort((a, b) => {
    const bA = budgetMap[a] || 0;
    const bB = budgetMap[b] || 0;
    if (bB !== bA) return bB - bA;
    return (spentByCat[b] || 0) - (spentByCat[a] || 0);
  });

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(232, 207, 193, 0.06)' : 'rgba(0,0,0,0.05)';
  const textColor = isDark ? '#A89B95' : '#7D7073';
  const labelColor = isDark ? '#F5EFEA' : '#262021';

  const labels = allCatIds.map(id => getCat(id).name);

  const budgetedData = allCatIds.map(id => budgetMap[id] || 0);
  const spentData = allCatIds.map(id => spentByCat[id] || 0);

  // Background and border colors for Spent bars:
  // Over budget: muted terracotta crimson (#D97272)
  // At exact limit or near (>=80%): warm amber (#E0A96D)
  // Under budget (<80%): sage emerald (#7FB093)
  const spentBgColors = allCatIds.map(id => {
    const budget = budgetMap[id] || 0;
    const spent = spentByCat[id] || 0;
    if (budget > 0) {
      if (spent > budget) return 'rgba(217, 114, 114, 0.88)';
      if (spent === budget || spent >= budget * 0.8) return 'rgba(224, 169, 109, 0.88)';
      return 'rgba(127, 176, 147, 0.88)';
    }
    return isDark ? 'rgba(168, 155, 149, 0.6)' : 'rgba(125, 112, 115, 0.6)';
  });

  const spentBorderColors = allCatIds.map(id => {
    const budget = budgetMap[id] || 0;
    const spent = spentByCat[id] || 0;
    if (budget > 0) {
      if (spent > budget) return '#D97272';
      if (spent === budget || spent >= budget * 0.8) return '#E0A96D';
      return '#7FB093';
    }
    return '#A89B95';
  });

  try {
    state.budgetChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Budgeted',
            data: budgetedData,
            backgroundColor: isDark ? 'rgba(223, 196, 152, 0.30)' : 'rgba(223, 196, 152, 0.38)',
            borderColor: '#DFC498',
            borderWidth: 1.5,
            borderRadius: 4,
            barPercentage: 0.75,
            categoryPercentage: 0.75,
          },
          {
            label: 'Actual Spent',
            data: spentData,
            backgroundColor: spentBgColors,
            borderColor: spentBorderColors,
            borderWidth: 1.5,
            borderRadius: 4,
            barPercentage: 0.75,
            categoryPercentage: 0.75,
          }
        ]
      },
      options: {
        indexAxis: 'y',
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
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw || 0;
                const catId = allCatIds[ctx.dataIndex];
                const budget = budgetMap[catId] || 0;
                if (ctx.datasetIndex === 0) {
                  return `  Budgeted: ${fmtCurrency(val, true)}`;
                } else {
                  let statusInfo = '';
                  if (budget > 0) {
                    const diff = val - budget;
                    if (diff > 0) {
                      statusInfo = ` (Over by ${fmtCurrency(diff, true)})`;
                    } else if (diff === 0) {
                      statusInfo = ` (₹0.00 left • 100% used)`;
                    } else {
                      statusInfo = ` (${fmtCurrency(Math.abs(diff), true)} left)`;
                    }
                  } else {
                    statusInfo = ` (No budget set)`;
                  }
                  return `  Actual Spent: ${fmtCurrency(val, true)}${statusInfo}`;
                }
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            border: { display: false },
            ticks: {
              color: textColor,
              font: { size: 11 },
              callback: (val) => {
                if (val >= 100000) return '₹' + (val / 100000).toFixed(1) + 'L';
                if (val >= 1000) return '₹' + (val / 1000).toFixed(0) + 'k';
                return '₹' + val;
              }
            }
          },
          y: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: labelColor,
              font: { size: 12, weight: '600' }
            }
          }
        }
      }
    });
  } catch (err) {
    console.warn('Budget comparison chart error:', err);
  }
}

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

  // Collect all category IDs to compare (budgeted or with spending)
  const budgetCatIds = monthBudgets.map(b => b.categoryId);
  const spentCatIds = Object.keys(spentByCat).filter(c => spentByCat[c] > 0);
  const allCatIds = Array.from(new Set([...budgetCatIds, ...spentCatIds]));
  const chartHeight = Math.max(220, allCatIds.length * 42 + 50);

  const comparisonChartCard = allCatIds.length > 0 ? `
  <div class="budget-chart-card card">
    <div class="card-header-row">
      <div>
        <div class="card-heading">Budget vs. Actual Spending</div>
        <div class="card-subheading">Side-by-side comparison per category for ${monthLabel(month)}</div>
      </div>
      <div class="budget-chart-legend">
        <span class="legend-item"><span class="legend-dot dot-budget"></span> Budgeted</span>
        <span class="legend-item"><span class="legend-dot dot-under"></span> Under Budget</span>
        <span class="legend-item"><span class="legend-dot dot-warn"></span> 80–100% Used</span>
        <span class="legend-item"><span class="legend-dot dot-over"></span> Over Budget</span>
      </div>
    </div>
    <div class="budget-chart-wrap" style="position:relative;height:${chartHeight}px">
      <canvas id="budgetComparisonChart"></canvas>
    </div>
  </div>` : '';

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
  ${comparisonChartCard}
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
  const month = state.currentMonth;
  const budgets = await db.getAll('budgets');
  const monthBudgets = budgets.filter(b => b.month === month);
  const expenses = await db.getByIndex('expenses', 'month', month);
  const allDebitExpenses = expenses.filter(e => e.type !== 'credit');
  const spentByCat = {};
  for (const e of allDebitExpenses) spentByCat[e.category] = (spentByCat[e.category] || 0) + e.amount;

  renderBudgetComparisonChart(monthBudgets, spentByCat);

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
    document.getElementById('parsed-meta').textContent = `Date: ${result.date}${result.refNo ? ` · Ref: ${result.refNo}` : ''}`;
  });

  document.getElementById('btn-save-parsed-alert')?.addEventListener('click', async () => {
    if (!lastParsedTxn) return;
    const catGuess = await autoCategory(lastParsedTxn.merchant);
    await db.add('expenses', {
      amount: lastParsedTxn.amount,
      merchant: lastParsedTxn.merchant,
      date: lastParsedTxn.date || today(),
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
