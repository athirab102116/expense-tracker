import { db } from './db.js';
import { playAdd, playDelete, playNav } from './audio.js';

// ─── Module Context & State ──────────────────────────────────────────────────
let _ctx = null;
let _countdownInterval = null;
let _currentFilter = 'all';
let _currentArchetype = 'all';
let _searchQuery = '';
let _currentViewMode = 'preview'; // 'preview' (ranked comparison preview) | 'cards' (standard grid)
let _previewSort = 'points_desc'; // 'points_desc' | 'points_asc' | 'price_desc' | 'price_asc' | 'cooling'
let _expandedItemIds = new Set(); // Stores IDs of items currently expanded in preview mode

export function initGatekeeper(context) {
  _ctx = context;
}

function getContext() {
  return _ctx || {
    categories: [],
    showToast: (msg) => console.log(msg),
    openModal: (id) => document.getElementById(id)?.classList.add('open'),
    closeModal: (id) => document.getElementById(id)?.classList.remove('open'),
    fmt: (amt) => '₹' + Number(amt).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    today: () => new Date().toISOString().slice(0, 10),
    renderView: () => {},
    gistSync: () => {}
  };
}

// ─── Constants & Configuration ───────────────────────────────────────────────
export const GATEKEEPER_ARCHETYPES = [
  {
    id: 'Core Upgrade',
    title: 'Core Upgrade',
    icon: '⚡',
    badge: 'Core Upgrade',
    desc: 'Work tool, daily device, ergonomic item, or essential quality-of-life replacement.',
    color: '#DFC498', // Champagne / Gold
    bg: 'rgba(223, 196, 152, 0.14)',
    border: 'rgba(223, 196, 152, 0.32)'
  },
  {
    id: 'Pure Dopamine / Treat',
    title: 'Pure Dopamine / Treat',
    icon: '🍬',
    badge: 'Pure Dopamine',
    desc: 'Spontaneous treat, hype drop, sudden late-night craving, or novelty indulgence.',
    color: '#B6899A', // Mauve / Rose
    bg: 'rgba(182, 137, 154, 0.14)',
    border: 'rgba(182, 137, 154, 0.32)'
  },
  {
    id: 'Goal / Skill Enabler',
    title: 'Goal / Skill Enabler',
    icon: '🎯',
    badge: 'Goal Enabler',
    desc: 'Fitness gear, coding course, educational books, instruments, or long-term growth.',
    color: '#8FA998', // Sage / Emerald
    bg: 'rgba(143, 169, 152, 0.14)',
    border: 'rgba(143, 169, 152, 0.32)'
  },
  {
    id: 'Aesthetic / Lifestyle',
    title: 'Aesthetic / Lifestyle',
    icon: '✨',
    badge: 'Aesthetic / Lifestyle',
    desc: 'Home decor, stylish fashion, fragrance, luxury accents, or ambient upgrade.',
    color: '#D99B84', // Terracotta / Brand
    bg: 'rgba(217, 155, 132, 0.14)',
    border: 'rgba(217, 155, 132, 0.32)'
  }
];

export const QUESTION_CONFIG = {
  frequency: {
    key: 'frequency',
    title: 'Frequency of Use',
    prompt: 'How often will you realistically use this item?',
    options: [
      {
        value: 'Daily (+25)',
        points: 25,
        title: 'Daily (+25)',
        desc: 'Every single day — integrated into daily workflow or routine.',
        icon: '☀️'
      },
      {
        value: 'Weekly (+15)',
        points: 15,
        title: 'Weekly (+15)',
        desc: 'Regularly 1–3 times every week.',
        icon: '🗓️'
      },
      {
        value: 'Rare (+5)',
        points: 5,
        title: 'Rare (+5)',
        desc: 'Special occasions, travel, or occasional novelty.',
        icon: '🕯️'
      }
    ]
  },
  redundancy: {
    key: 'redundancy',
    title: 'Redundancy & Overlap',
    prompt: 'Does this duplicate or replace something you already own?',
    options: [
      {
        value: 'No (+25)',
        points: 25,
        title: 'No (+25)',
        desc: 'First of its kind. Fills a genuine void with no existing substitute.',
        icon: '✨'
      },
      {
        value: 'Upgrade (+10)',
        points: 10,
        title: 'Upgrade (+10)',
        desc: 'Direct replacement for a damaged, slow, or worn-out item.',
        icon: '🔄'
      },
      {
        value: 'Duplicate (-10)',
        points: -10,
        title: 'Duplicate (-10)',
        desc: 'I already have a working item that serves this exact purpose.',
        icon: '⚠️'
      }
    ]
  },
  trigger: {
    key: 'trigger',
    title: 'Emotional Trigger',
    prompt: 'What prompted this sudden urge to purchase?',
    options: [
      {
        value: 'Planned (+25)',
        points: 25,
        title: 'Planned (+25)',
        desc: 'Researched deliberately for weeks; part of a planned roadmap.',
        icon: '🧠'
      },
      {
        value: 'Feed/Ad (0)',
        points: 0,
        title: 'Feed/Ad (0)',
        desc: 'Saw it on an Instagram/TikTok feed, sponsored banner, or flash sale.',
        icon: '📱'
      },
      {
        value: 'Stress/Bored (-5)',
        points: -5,
        title: 'Stress/Bored (-5)',
        desc: 'Feeling tired, stressed, low dopamine, or idle browsing.',
        icon: '🌧️'
      }
    ]
  },
  fit: {
    key: 'fit',
    title: 'Budget / Financial Fit',
    prompt: 'How does this purchase fit into this month’s cash flow?',
    options: [
      {
        value: 'Easy (+25)',
        points: 25,
        title: 'Easy (+25)',
        desc: 'Comfortably fits within this month\'s discretionary cash buffer.',
        icon: '🟢'
      },
      {
        value: 'Tight (+10)',
        points: 10,
        title: 'Tight (+10)',
        desc: 'Tightens this month’s budget slightly; will need to trim elsewhere.',
        icon: '🟡'
      },
      {
        value: 'Stretch (-10)',
        points: -10,
        title: 'Stretch (-10)',
        desc: 'Requires dipping into emergency savings or credit card debt.',
        icon: '🔴'
      }
    ]
  }
};

// ─── UUID Generator ─────────────────────────────────────────────────────────
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─── Utility Score & Tiers ──────────────────────────────────────────────────
export function computeUtilityScore(answers) {
  if (!answers) return 0;
  let score = 0;

  // Frequency
  if (answers.frequency?.includes('+25')) score += 25;
  else if (answers.frequency?.includes('+15')) score += 15;
  else if (answers.frequency?.includes('+5')) score += 5;

  // Redundancy
  if (answers.redundancy?.includes('+25')) score += 25;
  else if (answers.redundancy?.includes('+10')) score += 10;
  else if (answers.redundancy?.includes('-10')) score -= 10;

  // Trigger
  if (answers.trigger?.includes('+25')) score += 25;
  else if (answers.trigger?.includes('0')) score += 0;
  else if (answers.trigger?.includes('-5')) score -= 5;

  // Fit
  if (answers.fit?.includes('+25')) score += 25;
  else if (answers.fit?.includes('+10')) score += 10;
  else if (answers.fit?.includes('-10')) score -= 10;

  return Math.max(0, Math.min(100, score));
}

export function getUtilityTier(score) {
  if (score >= 80) {
    return {
      tier: 'high',
      label: 'High Utility · Justified',
      shortLabel: 'High Utility',
      color: '#7FB093', // Sage
      badgeBg: 'rgba(127, 176, 147, 0.16)',
      borderColor: 'rgba(127, 176, 147, 0.35)',
      desc: 'Strong necessity, premeditated need, and healthy financial alignment.'
    };
  } else if (score >= 50) {
    return {
      tier: 'moderate',
      label: 'Moderate Utility · Needs Caution',
      shortLabel: 'Moderate Utility',
      color: '#DFC498', // Champagne / Gold
      badgeBg: 'rgba(223, 196, 152, 0.16)',
      borderColor: 'rgba(223, 196, 152, 0.35)',
      desc: 'Reasonable use case, but cooling time is crucial to confirm value.'
    };
  } else {
    return {
      tier: 'low',
      label: 'Impulse Danger · Fleeting Dopamine',
      shortLabel: 'Impulse Danger',
      color: '#D97272', // Terracotta
      badgeBg: 'rgba(217, 114, 114, 0.16)',
      borderColor: 'rgba(217, 114, 114, 0.35)',
      desc: 'High risk of buyer remorse. Emotional trigger or duplicate utility.'
    };
  }
}

// ─── Cooling Timer Calculations ─────────────────────────────────────────────
export function getCoolingProgress(createdAt, unlockAt) {
  const start = new Date(createdAt).getTime();
  const end = new Date(unlockAt).getTime();
  const now = Date.now();
  const total = Math.max(1, end - start);
  const remaining = Math.max(0, end - now);
  const elapsed = total - remaining;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const isReady = remaining <= 0;

  const totalHours = Math.floor(remaining / (3600 * 1000));
  const totalMinutes = Math.floor((remaining % (3600 * 1000)) / (60 * 1000));
  const totalSeconds = Math.floor((remaining % (60 * 1000)) / 1000);

  let formatted = '';
  if (isReady) {
    formatted = 'Cooling complete';
  } else if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remHours = totalHours % 24;
    formatted = `${days}d ${remHours}h left`;
  } else if (totalHours > 0) {
    formatted = `${totalHours}h ${totalMinutes}m left`;
  } else {
    formatted = `${totalMinutes}m ${totalSeconds}s left`;
  }

  return { pct, remaining, isReady, formatted };
}

// ─── Sample Impulse Buy Detector ─────────────────────────────────────────────
export function isSampleImpulseBuy(item) {
  if (!item) return false;
  const id = String(item.id || '');
  if (
    id.startsWith('gk-sample-') ||
    id.startsWith('demo-gk-') ||
    ['gk-sample-1', 'gk-sample-2', 'gk-sample-3', 'gk-sample-4', 'demo-gk-1', 'demo-gk-2', 'demo-gk-3', 'demo-gk-4'].includes(id)
  ) {
    return true;
  }
  const name = String(item.name || '').trim().toLowerCase();
  const sampleTerms = [
    'hoodie',
    'vintage hoodie',
    'streetwear',
    'sony wh-1000xm5',
    'headphones',
    'flame diffuser',
    'diffuser',
    'keychron',
    'mechanical keyboard'
  ];
  if (sampleTerms.some(term => name.includes(term))) {
    return true;
  }
  const price = Number(item.price);
  if ((price === 4499 && name.includes('hoodie')) ||
      (price === 19990 && name.includes('sony')) ||
      (price === 2199 && name.includes('diffuser')) ||
      (price === 16499 && name.includes('keyboard'))) {
    return true;
  }
  return false;
}

// ─── Local Persistence Layer ────────────────────────────────────────────────
export async function getGatekeeperItems() {
  let items = [];
  if (typeof indexedDB !== 'undefined') {
    try {
      items = await db.getAll('gatekeeper');
    } catch (err) {
      console.warn('Could not read gatekeeper store from DB, checking fallback:', err);
    }
  }

  if (!items || !items.length) {
    try {
      if (typeof localStorage !== 'undefined') {
        const backup = localStorage.getItem('gatekeeper_items');
        if (backup) items = JSON.parse(backup);
      }
    } catch (_) {}
  }

  if (!Array.isArray(items)) items = [];

  // Strictly filter out any sample/demo impulse buys and delete them permanently
  const sampleItems = items.filter(it => isSampleImpulseBuy(it));
  if (sampleItems.length > 0) {
    items = items.filter(it => !isSampleImpulseBuy(it));
    if (typeof indexedDB !== 'undefined') {
      for (const s of sampleItems) {
        try { await db.delete('gatekeeper', s.id); } catch (_) {}
      }
    }
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('gatekeeper_items', JSON.stringify(items)); } catch (_) {}
    }
    try {
      if (_ctx && typeof _ctx.gistSync === 'function') {
        _ctx.gistSync();
      }
    } catch (_) {}
  }

  // Check cooling items for unlock transition
  let changed = false;
  const now = Date.now();
  for (const item of items) {
    if (item.status === 'cooling') {
      const unlockTime = new Date(item.unlockAt).getTime();
      if (now >= unlockTime) {
        item.status = 'ready';
        changed = true;
        if (typeof indexedDB !== 'undefined') {
          try { await db.put('gatekeeper', item); } catch (_) {}
        }
      }
    }
  }

  if (changed && typeof localStorage !== 'undefined') {
    try { localStorage.setItem('gatekeeper_items', JSON.stringify(items)); } catch (_) {}
  }

  return items;
}

export async function saveGatekeeperItem(item) {
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.put('gatekeeper', item);
    } catch (err) {
      console.warn('db.put failed for gatekeeper:', err);
    }
  }

  // Mirror to localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const items = await getGatekeeperItems();
      const idx = items.findIndex(i => i.id === item.id);
      if (idx >= 0) items[idx] = item;
      else items.unshift(item);
      localStorage.setItem('gatekeeper_items', JSON.stringify(items));
    }
  } catch (_) {}

  // Update notification badge counter
  updateGatekeeperBadge();
  try {
    if (_ctx && typeof _ctx.gistSync === 'function') _ctx.gistSync();
  } catch (_) {}
}

export async function deleteGatekeeperItem(id) {
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.delete('gatekeeper', id);
    } catch (err) {
      console.warn('db.delete failed for gatekeeper:', err);
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const backup = localStorage.getItem('gatekeeper_items');
      if (backup) {
        const items = JSON.parse(backup).filter(i => i.id !== id);
        localStorage.setItem('gatekeeper_items', JSON.stringify(items));
      }
    }
  } catch (_) {}

  updateGatekeeperBadge();
  try {
    if (_ctx && typeof _ctx.gistSync === 'function') _ctx.gistSync();
  } catch (_) {}
}

export async function clearAllGatekeeperItems() {
  if (typeof indexedDB !== 'undefined') {
    try {
      await db.clearStore('gatekeeper');
    } catch (_) {}
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('gatekeeper_items');
    }
  } catch (_) {}

  updateGatekeeperBadge();
  try {
    if (_ctx && typeof _ctx.gistSync === 'function') _ctx.gistSync();
  } catch (_) {}
}

export async function updateGatekeeperBadge() {
  try {
    const items = await getGatekeeperItems();
    const readyCount = items.filter(i => i.status === 'ready').length;
    const badge = document.getElementById('sidebar-gk-badge');
    if (badge) {
      if (readyCount > 0) {
        badge.textContent = readyCount;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (_) {}
}

// ─── Actions & Handlers ──────────────────────────────────────────────────────
export async function handleLogImpulse(formData) {
  const ctx = getContext();
  const coolingHours = Number(formData.coolingHours) || 48;
  const createdAt = new Date().toISOString();
  const unlockAt = new Date(Date.now() + coolingHours * 3600 * 1000).toISOString();
  const utilityScore = computeUtilityScore(formData.answers);
  const isFuture = formData.initialStatus === 'future';

  const item = {
    id: generateUUID(),
    name: formData.name.trim(),
    price: Number(formData.price) || 0,
    gatekeeperCategory: formData.gatekeeperCategory || 'Pure Dopamine / Treat',
    budgetCategory: formData.budgetCategory || 'Shopping',
    coolingHours,
    createdAt,
    unlockAt,
    utilityScore,
    answers: {
      frequency: formData.answers?.frequency || 'Daily (+25)',
      redundancy: formData.answers?.redundancy || 'No (+25)',
      trigger: formData.answers?.trigger || 'Planned (+25)',
      fit: formData.answers?.fit || 'Easy (+25)'
    },
    status: isFuture ? 'future' : 'cooling',
    movedToFutureAt: isFuture ? createdAt : null,
    futureNote: formData.futureNote || ''
  };

  await saveGatekeeperItem(item);
  playAdd();
  if (isFuture) {
    ctx.showToast(`📌 Saved "${item.name}" to Future Reference List!`);
  } else {
    ctx.showToast(`🛡️ Locked "${item.name}" into ${coolingHours}h cooling queue!`);
  }
  ctx.closeModal('gatekeeper-modal');
  if (ctx.gistSync) ctx.gistSync();
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemMoveToFuture(id, note = '') {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  item.status = 'future';
  item.movedToFutureAt = new Date().toISOString();
  if (note && typeof note === 'string') {
    item.futureNote = note.trim();
  }

  await saveGatekeeperItem(item);
  playAdd();
  ctx.showToast(`📌 Moved "${item.name}" to Future List for reference!`);
  if (ctx.gistSync) ctx.gistSync();
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemMoveBackToCooling(id) {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  const coolingHours = item.coolingHours || 48;
  item.status = 'cooling';
  item.createdAt = new Date().toISOString();
  item.unlockAt = new Date(Date.now() + coolingHours * 3600 * 1000).toISOString();

  await saveGatekeeperItem(item);
  playAdd();
  ctx.showToast(`⏳ Moved "${item.name}" back to Cooling Queue (${coolingHours}h)`);
  if (ctx.gistSync) ctx.gistSync();
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemLetGo(id) {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  item.status = 'let_go';
  await saveGatekeeperItem(item);
  playAdd();
  ctx.showToast(`🏆 Impulse resisted! Saved ${ctx.fmt(item.price)} to your wallet!`);
  if (ctx.gistSync) ctx.gistSync();
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemPurchased(id) {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  // Automatically convert to expense in Expense Tracker
  try {
    const expense = {
      amount: Number(item.price) || 0,
      category: (item.budgetCategory || 'Shopping').toLowerCase(),
      merchant: item.name,
      note: `Gatekeeper purchase (${item.coolingHours}h cooling)`,
      method: 'UPI',
      date: ctx.today(),
      month: ctx.today().slice(0, 7),
      type: 'debit',
      createdAt: Date.now()
    };
    await db.add('expenses', expense);
  } catch (err) {
    console.warn('Failed to add transaction from gatekeeper purchase:', err);
  }

  item.status = 'purchased';
  await saveGatekeeperItem(item);
  playAdd();
  ctx.showToast(`🎉 Purchased "${item.name}" (${ctx.fmt(item.price)}) — Logged to transactions!`);
  if (ctx.gistSync) ctx.gistSync();
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemExtendCooling(id, extraHours = 24) {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  const currentUnlock = Math.max(Date.now(), new Date(item.unlockAt).getTime());
  item.coolingHours = (item.coolingHours || 48) + extraHours;
  item.unlockAt = new Date(currentUnlock + extraHours * 3600 * 1000).toISOString();
  item.status = 'cooling';

  await saveGatekeeperItem(item);
  ctx.showToast(`⏳ Extended cooling by ${extraHours}h for "${item.name}"`);
  if (ctx.renderView) ctx.renderView();
}

export async function handleItemUnlockNow(id) {
  const ctx = getContext();
  const items = await getGatekeeperItems();
  const item = items.find(i => i.id === id);
  if (!item) return;

  item.unlockAt = new Date().toISOString();
  item.status = 'ready';

  await saveGatekeeperItem(item);
  ctx.showToast(`✨ "${item.name}" is now ready for final evaluation!`);
  if (ctx.renderView) ctx.renderView();
}

// ─── Render Gatekeeper View ──────────────────────────────────────────────────
export async function renderGatekeeper() {
  const ctx = getContext();
  const items = await getGatekeeperItems();

  // Metrics
  const letGoItems = items.filter(i => i.status === 'let_go');
  const totalSaved = letGoItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const coolingItems = items.filter(i => i.status === 'cooling');
  const totalCoolingAmt = coolingItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const readyItems = items.filter(i => i.status === 'ready');
  const totalReadyAmt = readyItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const purchasedItems = items.filter(i => i.status === 'purchased');
  const totalPurchasedAmt = purchasedItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const futureItems = items.filter(i => i.status === 'future');
  const totalFutureAmt = futureItems.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const resolvedCount = letGoItems.length + purchasedItems.length;
  const resistedRate = resolvedCount > 0 ? Math.round((letGoItems.length / resolvedCount) * 100) : 0;
  const avgUtility = items.length > 0 ? Math.round(items.reduce((s, i) => s + (Number(i.utilityScore) || 0), 0) / items.length) : 0;

  // Filter items
  let filtered = [...items];
  if (_currentFilter !== 'all') {
    filtered = filtered.filter(i => i.status === _currentFilter);
  }
  if (_currentArchetype !== 'all') {
    filtered = filtered.filter(i => i.gatekeeperCategory === _currentArchetype);
  }
  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase().trim();
    filtered = filtered.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.gatekeeperCategory || '').toLowerCase().includes(q) ||
      (i.budgetCategory || '').toLowerCase().includes(q)
    );
  }

  // Sort items according to view mode
  if (_currentViewMode === 'preview') {
    filtered.sort((a, b) => {
      if (_previewSort === 'points_desc') {
        const diff = (Number(b.utilityScore) || 0) - (Number(a.utilityScore) || 0);
        if (diff !== 0) return diff;
        return (Number(a.price) || 0) - (Number(b.price) || 0);
      } else if (_previewSort === 'points_asc') {
        const diff = (Number(a.utilityScore) || 0) - (Number(b.utilityScore) || 0);
        if (diff !== 0) return diff;
        return (Number(b.price) || 0) - (Number(a.price) || 0);
      } else if (_previewSort === 'price_desc') {
        return (Number(b.price) || 0) - (Number(a.price) || 0);
      } else if (_previewSort === 'price_asc') {
        return (Number(a.price) || 0) - (Number(b.price) || 0);
      } else if (_previewSort === 'cooling') {
        return new Date(a.unlockAt || 0) - new Date(b.unlockAt || 0);
      }
      return (Number(b.utilityScore) || 0) - (Number(a.utilityScore) || 0);
    });
  } else {
    // Standard cards sort: Ready first, then cooling (closest unlock first), then future, then recent
    filtered.sort((a, b) => {
      if (a.status === 'ready' && b.status !== 'ready') return -1;
      if (b.status === 'ready' && a.status !== 'ready') return 1;
      if (a.status === 'cooling' && b.status === 'cooling') {
        return new Date(a.unlockAt) - new Date(b.unlockAt);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  return `
  <div class="gk-view-wrap">
    <!-- View Banner Header with Secondary Quick Action Button -->
    <div class="gk-header-banner">
      <div class="gk-header-text">
        <div class="gk-title-row">
          <div class="gk-shield-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </div>
          <div>
            <h1 class="gk-view-title">Purchase Gatekeeper</h1>
            <p class="gk-view-subtitle">Cooling-Off Queue &amp; Utility Assessment to eliminate impulse spending</p>
          </div>
        </div>
      </div>
      <div class="gk-header-actions">
        ${items.length > 0 ? `
          <button class="btn-secondary gk-clear-all-btn" id="gk-clear-all-btn" style="font-size:12px;padding:6px 12px" title="Clear all impulse items from the queue">
            🗑️ Clear Queue
          </button>
        ` : ''}
        <!-- Secondary Quick-Action Button -->
        <button class="btn-primary gk-log-impulse-btn" id="gk-top-add-btn" title="Log a new impulse item into the cooling queue">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>+ Log Impulse</span>
        </button>
      </div>
    </div>

    <!-- Ready Notification Banner (if any) -->
    ${readyItems.length > 0 ? `
      <div class="gk-ready-banner card">
        <div class="gk-ready-banner-left">
          <div class="gk-ready-bell">🔔</div>
          <div>
            <div class="gk-ready-title">${readyItems.length} Impulse Item${readyItems.length > 1 ? 's' : ''} Ready for Decision!</div>
            <div class="gk-ready-sub">The 48h cooling period has expired. How do you feel about these items now?</div>
          </div>
        </div>
        <button class="btn-secondary-sm gk-filter-pill-trigger" data-filter="ready">Review Ready Items (${readyItems.length})</button>
      </div>
    ` : ''}

    <!-- KPI Summary Row -->
    <div class="gk-kpi-grid">
      <!-- Card 1: Resisted Impulses (Saved) -->
      <div class="gk-kpi-card card card-saved">
        <div class="gk-kpi-top">
          <span class="gk-kpi-label">Resisted Impulses (Saved)</span>
          <span class="gk-kpi-badge badge-green">🛡️ Kept</span>
        </div>
        <div class="gk-kpi-val text-income">${ctx.fmt(totalSaved)}</div>
        <div class="gk-kpi-sub">${letGoItems.length} impulse${letGoItems.length === 1 ? '' : 's'} resisted · Real money kept</div>
      </div>

      <!-- Card 2: Cooling Queue -->
      <div class="gk-kpi-card card">
        <div class="gk-kpi-top">
          <span class="gk-kpi-label">Cooling Off Now</span>
          <span class="gk-kpi-badge badge-gold">⏳ Queue</span>
        </div>
        <div class="gk-kpi-val text-gold">${ctx.fmt(totalCoolingAmt)}</div>
        <div class="gk-kpi-sub">${coolingItems.length} item${coolingItems.length === 1 ? '' : 's'} currently in cooling buffer</div>
      </div>

      <!-- Card 3: Ready for Decision -->
      <div class="gk-kpi-card card">
        <div class="gk-kpi-top">
          <span class="gk-kpi-label">Ready for Decision</span>
          <span class="gk-kpi-badge badge-brand">🔔 Unlocked</span>
        </div>
        <div class="gk-kpi-val text-brand">${readyItems.length}</div>
        <div class="gk-kpi-sub">${ctx.fmt(totalReadyAmt)} waiting for final yes/no</div>
      </div>

      <!-- Card 4: Future Reference / Wishlist -->
      <div class="gk-kpi-card card">
        <div class="gk-kpi-top">
          <span class="gk-kpi-label">Future Reference</span>
          <span class="gk-kpi-badge badge-mauve">📌 Saved</span>
        </div>
        <div class="gk-kpi-val text-mauve">${ctx.fmt(totalFutureAmt)}</div>
        <div class="gk-kpi-sub">${futureItems.length} item${futureItems.length === 1 ? '' : 's'} saved for later · ${resistedRate}% restraint</div>
      </div>
    </div>

    <!-- Action Bar: Filters, Archetypes, and Search -->
    <div class="gk-toolbar card">
      <div class="gk-toolbar-left">
        <!-- Status Tabs -->
        <div class="gk-status-tabs" role="tablist">
          <button class="gk-tab-btn ${_currentFilter === 'all' ? 'active' : ''}" data-filter="all">
            All <span class="gk-tab-count">${items.length}</span>
          </button>
          <button class="gk-tab-btn ${_currentFilter === 'cooling' ? 'active' : ''}" data-filter="cooling">
            ⏳ Cooling <span class="gk-tab-count">${coolingItems.length}</span>
          </button>
          <button class="gk-tab-btn ${_currentFilter === 'ready' ? 'active' : ''}" data-filter="ready">
            🔔 Ready <span class="gk-tab-count ${readyItems.length > 0 ? 'gk-count-highlight' : ''}">${readyItems.length}</span>
          </button>
          <button class="gk-tab-btn ${_currentFilter === 'future' ? 'active' : ''}" data-filter="future">
            📌 Future List <span class="gk-tab-count">${futureItems.length}</span>
          </button>
          <button class="gk-tab-btn ${_currentFilter === 'let_go' ? 'active' : ''}" data-filter="let_go">
            🛡️ Resisted <span class="gk-tab-count">${letGoItems.length}</span>
          </button>
          <button class="gk-tab-btn ${_currentFilter === 'purchased' ? 'active' : ''}" data-filter="purchased">
            💳 Bought <span class="gk-tab-count">${purchasedItems.length}</span>
          </button>
        </div>
      </div>

      <div class="gk-toolbar-right">
        <!-- View Mode Toggle: Ranked Preview vs Cards Grid -->
        <div class="gk-view-toggle-grp" role="group" aria-label="View format">
          <button class="gk-view-mode-btn ${_currentViewMode === 'preview' ? 'active' : ''}" data-view="preview" title="Preview List ranked by points">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            <span>Ranked Preview</span>
          </button>
          <button class="gk-view-mode-btn ${_currentViewMode === 'cards' ? 'active' : ''}" data-view="cards" title="Cards grid view">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            <span>Cards</span>
          </button>
        </div>

        <!-- Archetype Filter -->
        <select id="gk-archetype-select" class="gk-select-filter" aria-label="Filter by archetype">
          <option value="all" ${_currentArchetype === 'all' ? 'selected' : ''}>All Archetypes</option>
          ${GATEKEEPER_ARCHETYPES.map(a => `
            <option value="${a.id}" ${_currentArchetype === a.id ? 'selected' : ''}>${a.icon} ${a.title}</option>
          `).join('')}
        </select>

        <!-- Search Input -->
        <div class="gk-search-box">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" id="gk-search-input" placeholder="Search impulse items..." value="${_searchQuery}">
          ${_searchQuery ? `<button id="gk-search-clear" class="gk-search-clear-btn">✕</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Items Content: Ranked Preview List or Cards Grid -->
    ${filtered.length === 0 ? renderEmptyState(items.length) : `
      ${_currentViewMode === 'preview'
        ? renderPreviewList(filtered, ctx)
        : `<div class="gk-cards-grid">${filtered.map(item => renderItemCard(item, ctx)).join('')}</div>`
      }
    `}
  </div>
  `;
}

function renderEmptyState(totalItemsCount) {
  if (totalItemsCount === 0) {
    return `
      <div class="gk-empty-state card">
        <div class="gk-empty-icon">🛡️</div>
        <h2 class="gk-empty-title">Your Cooling Queue is Empty</h2>
        <p class="gk-empty-sub">
          Got an urge to buy something? Put it into the Gatekeeper first.<br>
          Let the impulsive dopamine settle for 48 hours to see if it’s a real need or fleeting craving.
        </p>
        <button class="btn-primary gk-empty-action-btn" id="gk-empty-log-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>+ Log Your First Impulse</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="gk-empty-state card">
      <div class="gk-empty-icon">🔍</div>
      <h2 class="gk-empty-title">No items match your filter</h2>
      <p class="gk-empty-sub">Try changing the status tab, archetype dropdown, or search keyword.</p>
      <button class="btn-secondary-sm" id="gk-reset-filters-btn">Reset Filters</button>
    </div>
  `;
}

// ─── Ranked Preview & Comparison List ─────────────────────────────────────────
function renderPreviewList(filtered, ctx) {
  if (!filtered || filtered.length === 0) return '';

  // Calculate comparison statistics
  const sortedByScore = [...filtered].sort((a, b) => (Number(b.utilityScore) || 0) - (Number(a.utilityScore) || 0));
  const topItem = sortedByScore[0];
  const avgScore = Math.round(filtered.reduce((sum, i) => sum + (Number(i.utilityScore) || 0), 0) / filtered.length);
  const totalAmount = filtered.reduce((sum, i) => sum + (Number(i.price) || 0), 0);

  // Best Value (highest utility points per Rupee)
  const sortedByValue = [...filtered].sort((a, b) => {
    const ratioA = (Number(a.utilityScore) || 0) / Math.max(Number(a.price) || 1, 1);
    const ratioB = (Number(b.utilityScore) || 0) / Math.max(Number(b.price) || 1, 1);
    return ratioB - ratioA;
  });
  const bestValueItem = sortedByValue[0];

  const allExpanded = filtered.length > 0 && filtered.every(i => _expandedItemIds.has(i.id));

  return `
  <div class="gk-preview-wrap">
    <!-- Comparison Insights Ribbon -->
    <div class="gk-compare-summary card">
      <div class="gk-compare-grid">
        <div class="gk-compare-cell">
          <div class="gk-compare-cell-lbl">🏆 Highest Utility Rank #1</div>
          <div class="gk-compare-cell-title" title="${topItem ? topItem.name : ''}">${topItem ? topItem.name : '—'}</div>
          <div class="gk-compare-cell-sub">
            <strong class="text-brand">${topItem ? topItem.utilityScore : 0} pts</strong> · ${topItem ? ctx.fmt(topItem.price) : '₹0'}
          </div>
        </div>

        <div class="gk-compare-cell">
          <div class="gk-compare-cell-lbl">📊 Average Utility Score</div>
          <div class="gk-compare-cell-val text-income">
            ${avgScore} <span style="font-size:13px;font-weight:600;color:var(--text3)">/ 100</span>
          </div>
          <div class="gk-compare-cell-sub">Across ${filtered.length} compared impulse${filtered.length === 1 ? '' : 's'} (${ctx.fmt(totalAmount)})</div>
        </div>

        <div class="gk-compare-cell">
          <div class="gk-compare-cell-lbl">💡 Best Value-For-Money Ratio</div>
          <div class="gk-compare-cell-title" title="${bestValueItem ? bestValueItem.name : ''}">${bestValueItem ? bestValueItem.name : '—'}</div>
          <div class="gk-compare-cell-sub">
            <strong class="text-gold">${bestValueItem ? bestValueItem.utilityScore : 0} pts</strong> · ${bestValueItem ? ctx.fmt(bestValueItem.price) : '₹0'}
          </div>
        </div>
      </div>

      <!-- Controls row in comparison bar -->
      <div class="gk-compare-controls-bar">
        <div class="gk-compare-sort-box">
          <label for="gk-preview-sort-select" class="gk-sort-lbl">Rank by:</label>
          <select id="gk-preview-sort-select" class="gk-select-filter-sm" aria-label="Sort comparison items">
            <option value="points_desc" ${_previewSort === 'points_desc' ? 'selected' : ''}>Points: High → Low (Ranked #1)</option>
            <option value="points_asc" ${_previewSort === 'points_asc' ? 'selected' : ''}>Points: Low → High</option>
            <option value="price_desc" ${_previewSort === 'price_desc' ? 'selected' : ''}>Price: High → Low</option>
            <option value="price_asc" ${_previewSort === 'price_asc' ? 'selected' : ''}>Price: Low → High</option>
            <option value="cooling" ${_previewSort === 'cooling' ? 'selected' : ''}>Cooling Time Remaining</option>
          </select>
        </div>

        <div class="gk-compare-right-actions">
          <button id="gk-expand-all-btn" class="btn-ghost-sm gk-expand-all-btn" title="Toggle detailed options for all items">
            ${allExpanded ? '▲ Collapse All' : '▼ Expand &amp; Compare All'}
          </button>
        </div>
      </div>
    </div>

    <!-- Ranked Preview List Container -->
    <div class="gk-preview-list-container">
      <div class="gk-preview-table-header">
        <div class="gk-th-rank">Rank &amp; Points</div>
        <div class="gk-th-item">Impulse Item &amp; Archetype</div>
        <div class="gk-th-answers">Diagnostic Answers Preview</div>
        <div class="gk-th-price">Price &amp; Ratio</div>
        <div class="gk-th-status">Status</div>
        <div class="gk-th-action">Options</div>
      </div>

      <div class="gk-preview-rows-list">
        ${filtered.map((item, index) => renderPreviewItemRow(item, index, ctx)).join('')}
      </div>
    </div>
  </div>
  `;
}

function renderPreviewItemRow(item, index, ctx) {
  const isExpanded = _expandedItemIds.has(item.id);
  const archetype = GATEKEEPER_ARCHETYPES.find(a => a.id === item.gatekeeperCategory) || GATEKEEPER_ARCHETYPES[0];
  const { pct, remaining, isReady, formatted } = getCoolingProgress(item.createdAt, item.unlockAt);
  const tier = getUtilityTier(item.utilityScore);
  const answers = item.answers || {};
  const effectiveStatus = (item.status === 'cooling' && isReady) ? 'ready' : item.status;

  // Rank Badge
  let rankClass = 'rank-pill-normal';
  let rankLabel = `#${index + 1}`;
  if (_previewSort === 'points_desc') {
    if (index === 0) { rankClass = 'rank-pill-gold'; rankLabel = '🥇 #1'; }
    else if (index === 1) { rankClass = 'rank-pill-silver'; rankLabel = '🥈 #2'; }
    else if (index === 2) { rankClass = 'rank-pill-bronze'; rankLabel = '🥉 #3'; }
  }

  // Cost per point
  const costPerPt = (item.price / Math.max(item.utilityScore, 1)).toFixed(0);

  // Status Badge markup
  let statusBadge = '';
  if (effectiveStatus === 'cooling') {
    statusBadge = `<span class="gk-status-badge status-cooling gk-timer-val" data-unlock="${item.unlockAt}" data-created="${item.createdAt}">⏳ ${formatted}</span>`;
  } else if (effectiveStatus === 'ready') {
    statusBadge = `<span class="gk-status-badge status-ready">✨ Ready</span>`;
  } else if (effectiveStatus === 'future') {
    statusBadge = `<span class="gk-status-badge status-future">📌 Future</span>`;
  } else if (effectiveStatus === 'let_go') {
    statusBadge = `<span class="gk-status-badge status-let-go">🛡️ Saved</span>`;
  } else if (effectiveStatus === 'purchased') {
    statusBadge = `<span class="gk-status-badge status-purchased">💳 Bought</span>`;
  }

  return `
  <div class="gk-preview-card card ${isExpanded ? 'is-expanded' : ''}" data-id="${item.id}">
    <div class="gk-preview-row" data-id="${item.id}" role="button" tabindex="0" aria-expanded="${isExpanded}" title="Click to view all options for ${item.name}">
      
      <!-- Rank & Points Column -->
      <div class="gk-th-rank gk-cell-rank">
        <div class="gk-rank-badge ${rankClass}">${rankLabel}</div>
        <div class="gk-points-meter">
          <div class="gk-points-val-box" style="color:${tier.color};background:${tier.badgeBg};border:1px solid ${tier.borderColor}">
            <strong>${item.utilityScore}</strong><span class="gk-points-den">/100</span>
          </div>
          <div class="gk-points-bar-mini" title="${item.utilityScore} points (${tier.label})">
            <div class="gk-points-fill-mini" style="width:${item.utilityScore}%;background:${tier.color}"></div>
          </div>
          <span class="gk-tier-tag" style="color:${tier.color}">${tier.shortLabel}</span>
        </div>
      </div>

      <!-- Item Info Column -->
      <div class="gk-th-item gk-cell-item">
        <h4 class="gk-preview-item-title" title="${item.name}">${item.name}</h4>
        <div class="gk-preview-pills-row">
          <span class="gk-arch-pill-sm" style="color:${archetype.color};background:${archetype.bg};border:1px solid ${archetype.border}">
            ${archetype.icon} ${archetype.badge}
          </span>
          <span class="gk-budget-pill-sm">
            🏷️ ${item.budgetCategory || 'Shopping'}
          </span>
        </div>
      </div>

      <!-- Diagnostic Answers Preview -->
      <div class="gk-th-answers gk-cell-answers">
        <div class="gk-factor-chips-wrap">
          <span class="gk-chip" title="Usage: ${answers.frequency || 'Daily (+25)'}">
            <span class="gk-chip-k">Use:</span> ${answers.frequency || 'Daily (+25)'}
          </span>
          <span class="gk-chip" title="Need/Redundancy: ${answers.redundancy || 'No (+25)'}">
            <span class="gk-chip-k">Need:</span> ${answers.redundancy || 'No (+25)'}
          </span>
          <span class="gk-chip" title="Trigger: ${answers.trigger || 'Planned (+25)'}">
            <span class="gk-chip-k">Trigger:</span> ${answers.trigger || 'Planned (+25)'}
          </span>
          <span class="gk-chip" title="Financial Fit: ${answers.fit || 'Easy (+25)'}">
            <span class="gk-chip-k">Fit:</span> ${answers.fit || 'Easy (+25)'}
          </span>
        </div>
      </div>

      <!-- Price & Efficiency Ratio Column -->
      <div class="gk-th-price gk-cell-price">
        <div class="gk-preview-amount">${ctx.fmt(item.price)}</div>
        <div class="gk-preview-ratio" title="Cost per utility point">₹${Number(costPerPt).toLocaleString('en-IN')}/pt</div>
      </div>

      <!-- Status Column -->
      <div class="gk-th-status gk-cell-status">
        ${statusBadge}
      </div>

      <!-- Expand Trigger Column -->
      <div class="gk-th-action gk-cell-action">
        <button class="btn-secondary-sm gk-row-expand-btn" data-id="${item.id}" title="Toggle detailed options">
          ${isExpanded ? 'Hide ▲' : 'Options ▼'}
        </button>
      </div>

    </div>

    <!-- Expanded Item Card Panel with ALL options available -->
    ${isExpanded ? `
      <div class="gk-preview-detail-drawer">
        <div class="gk-drawer-top-banner">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:var(--text)">All Available Options for "${item.name}"</span>
            <span class="gk-score-pill" style="color:${tier.color};background:${tier.badgeBg};border-color:${tier.borderColor}">Rank #${index + 1} · ${item.utilityScore}/100 pts</span>
          </div>
          <button class="btn-ghost-sm gk-close-drawer-btn" data-id="${item.id}" title="Collapse options">✕ Close</button>
        </div>
        ${renderItemCard(item, ctx)}
      </div>
    ` : ''}
  </div>
  `;
}

function renderItemCard(item, ctx) {
  const archetype = GATEKEEPER_ARCHETYPES.find(a => a.id === item.gatekeeperCategory) || GATEKEEPER_ARCHETYPES[0];
  const { pct, remaining, isReady, formatted } = getCoolingProgress(item.createdAt, item.unlockAt);
  const tier = getUtilityTier(item.utilityScore);
  const answers = item.answers || {};

  // Effective status
  const effectiveStatus = (item.status === 'cooling' && isReady) ? 'ready' : item.status;

  // Status Badge markup
  let statusBadge = '';
  if (effectiveStatus === 'cooling') {
    statusBadge = `<span class="gk-status-badge status-cooling">⏳ Cooling (${formatted})</span>`;
  } else if (effectiveStatus === 'ready') {
    statusBadge = `<span class="gk-status-badge status-ready">✨ Unlocked · Decision Time</span>`;
  } else if (effectiveStatus === 'future') {
    statusBadge = `<span class="gk-status-badge status-future">📌 Future Reference</span>`;
  } else if (effectiveStatus === 'let_go') {
    statusBadge = `<span class="gk-status-badge status-let-go">🛡️ Resisted · Saved ${ctx.fmt(item.price)}</span>`;
  } else if (effectiveStatus === 'purchased') {
    statusBadge = `<span class="gk-status-badge status-purchased">💳 Purchased &amp; Logged</span>`;
  } else if (effectiveStatus === 'approved') {
    statusBadge = `<span class="gk-status-badge status-approved">✅ Approved to Buy</span>`;
  }

  return `
  <div class="gk-card card gk-card-${effectiveStatus}" data-id="${item.id}" data-unlock="${item.unlockAt}" data-created="${item.createdAt}">
    <!-- Card Top Bar -->
    <div class="gk-card-top">
      <div class="gk-card-badges">
        <!-- Archetype Badge -->
        <span class="gk-arch-badge" style="color:${archetype.color};background:${archetype.bg};border-color:${archetype.border}">
          ${archetype.icon} ${archetype.badge}
        </span>
        <!-- Budget Category Badge -->
        <span class="gk-budget-badge">
          🏷️ ${item.budgetCategory || 'Shopping'}
        </span>
      </div>
      <div>
        ${statusBadge}
      </div>
    </div>

    <!-- Card Main Info -->
    <div class="gk-card-main">
      <div class="gk-card-heading">
        <h3 class="gk-card-name" title="${item.name}">${item.name}</h3>
        <div class="gk-card-price">${ctx.fmt(item.price)}</div>
      </div>
    </div>

    <!-- Cooling Timer Bar (if cooling or ready) -->
    ${effectiveStatus === 'cooling' ? `
      <div class="gk-cooling-section">
        <div class="gk-cooling-labels">
          <span class="gk-cooling-text">Cooling Off</span>
          <span class="gk-cooling-countdown gk-timer-val" data-unlock="${item.unlockAt}" data-created="${item.createdAt}">
            ⏳ ${formatted}
          </span>
        </div>
        <div class="gk-progress-track">
          <div class="gk-progress-fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="gk-cooling-sub">
          Locked for ${item.coolingHours}h · Unlocks ${new Date(item.unlockAt).toLocaleString('en-IN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
        </div>
      </div>
    ` : ''}

    ${effectiveStatus === 'ready' ? `
      <div class="gk-ready-prompt">
        <div class="gk-ready-sparkle">✨ 48h Cooling Complete</div>
        <div class="gk-ready-desc">The impulsive craving period has elapsed. Do you still genuinely desire this item?</div>
      </div>
    ` : ''}

    ${effectiveStatus === 'let_go' ? `
      <div class="gk-resolved-banner banner-saved">
        <span class="gk-resolved-icon">🏆</span>
        <div>
          <strong>Victory: Impulse Defeated</strong>
          <div class="gk-resolved-sub">You walked away and saved ${ctx.fmt(item.price)}</div>
        </div>
      </div>
    ` : ''}

    ${effectiveStatus === 'purchased' ? `
      <div class="gk-resolved-banner banner-bought">
        <span class="gk-resolved-icon">✓</span>
        <div>
          <strong>Conscious Purchase</strong>
          <div class="gk-resolved-sub">Evaluated through 48h cooling &amp; logged as a transaction</div>
        </div>
      </div>
    ` : ''}

    ${effectiveStatus === 'future' ? `
      <div class="gk-resolved-banner banner-future">
        <span class="gk-resolved-icon">📌</span>
        <div style="flex:1">
          <strong>Saved for Future Reference</strong>
          <div class="gk-resolved-sub">Kept on your wishlist for later consideration.${item.futureNote ? ` <span style="display:block;margin-top:2px;font-style:italic;color:var(--text)">"${item.futureNote}"</span>` : ''}</div>
        </div>
      </div>
    ` : ''}

    <!-- Diagnostic Utility Score Meter -->
    <div class="gk-utility-section">
      <div class="gk-utility-header">
        <span class="gk-utility-title">Diagnostic Utility Score</span>
        <div class="gk-score-pill" style="color:${tier.color};background:${tier.badgeBg};border-color:${tier.borderColor}">
          <strong>${item.utilityScore}/100</strong> · ${tier.shortLabel}
        </div>
      </div>
      <div class="gk-score-bar-track">
        <div class="gk-score-bar-fill" style="width:${item.utilityScore}%;background:${tier.color}"></div>
      </div>

      <!-- Diagnostic Answers Breakdown -->
      <div class="gk-answers-grid">
        <div class="gk-answer-item" title="Frequency: ${answers.frequency || 'N/A'}">
          <span class="gk-ans-lbl">Use</span>
          <span class="gk-ans-val">${answers.frequency || 'Daily (+25)'}</span>
        </div>
        <div class="gk-answer-item" title="Redundancy: ${answers.redundancy || 'N/A'}">
          <span class="gk-ans-lbl">Need</span>
          <span class="gk-ans-val">${answers.redundancy || 'No (+25)'}</span>
        </div>
        <div class="gk-answer-item" title="Trigger: ${answers.trigger || 'N/A'}">
          <span class="gk-ans-lbl">Trigger</span>
          <span class="gk-ans-val">${answers.trigger || 'Planned (+25)'}</span>
        </div>
        <div class="gk-answer-item" title="Financial Fit: ${answers.fit || 'N/A'}">
          <span class="gk-ans-lbl">Fit</span>
          <span class="gk-ans-val">${answers.fit || 'Easy (+25)'}</span>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="gk-card-actions">
      ${effectiveStatus === 'cooling' ? `
        <button class="btn-secondary-sm gk-action-btn gk-letgo-btn" data-id="${item.id}" title="Walk away and add to savings">
          🌿 Let It Go (Save ${ctx.fmt(item.price)})
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-future-btn" data-id="${item.id}" title="Move to future list to keep for future reference">
          📌 Future List
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-unlock-btn" data-id="${item.id}" title="Fast-forward cooling period for testing">
          ⚡ Unlock Now
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-del-btn" data-id="${item.id}" title="Delete impulse item">
          🗑️
        </button>
      ` : ''}

      ${effectiveStatus === 'ready' ? `
        <button class="btn-primary-sm gk-action-btn gk-buy-btn" data-id="${item.id}" title="Buy and convert to transaction">
          🛍️ Buy &amp; Log Expense
        </button>
        <button class="btn-secondary-sm gk-action-btn gk-letgo-btn" data-id="${item.id}" title="Walk away and save money">
          🌿 Let It Go
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-future-btn" data-id="${item.id}" title="Save to future reference list">
          📌 Future List
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-extend-btn" data-id="${item.id}" title="Cool off for another 24 hours">
          ⏳ +24h More
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-del-btn" data-id="${item.id}" title="Delete impulse item">
          🗑️
        </button>
      ` : ''}

      ${effectiveStatus === 'future' ? `
        <button class="btn-secondary-sm gk-action-btn gk-recool-btn" data-id="${item.id}" title="Move back to 48h cooling queue">
          ⏳ Re-cool (48h)
        </button>
        <button class="btn-primary-sm gk-action-btn gk-buy-btn" data-id="${item.id}" title="Ready to purchase and log transaction">
          🛍️ Buy &amp; Log
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-letgo-btn" data-id="${item.id}" title="Walk away and mark as avoided">
          🌿 Let It Go
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-del-btn" data-id="${item.id}" title="Delete item">
          🗑️
        </button>
      ` : ''}

      ${effectiveStatus === 'let_go' || effectiveStatus === 'purchased' ? `
        <span class="gk-date-logged">Logged on ${new Date(item.createdAt).toLocaleDateString('en-IN', { month:'short', day:'numeric' })}</span>
        <button class="btn-ghost-sm gk-action-btn gk-future-btn" data-id="${item.id}" title="Move back to Future Wishlist">
          📌 Future List
        </button>
        <button class="btn-ghost-sm gk-action-btn gk-del-btn" data-id="${item.id}" title="Delete item">
          🗑️ Delete
        </button>
      ` : ''}
    </div>
  </div>
  `;
}

// ─── Mount View Event Listeners ──────────────────────────────────────────────
export function mountGatekeeper() {
  const ctx = getContext();

  // Top "+ Log Impulse" Button
  document.getElementById('gk-top-add-btn')?.addEventListener('click', () => {
    openLogImpulseModal();
  });

  // Top "Clear Queue" Button
  document.getElementById('gk-clear-all-btn')?.addEventListener('click', async () => {
    if (confirm('Clear all impulse buy records from the Gatekeeper queue?')) {
      await clearAllGatekeeperItems();
      playDelete();
      ctx.showToast('Gatekeeper queue cleared');
      ctx.renderView();
    }
  });

  // Empty state button
  document.getElementById('gk-empty-log-btn')?.addEventListener('click', () => {
    openLogImpulseModal();
  });

  // Reset filters
  document.getElementById('gk-reset-filters-btn')?.addEventListener('click', () => {
    _currentFilter = 'all';
    _currentArchetype = 'all';
    _searchQuery = '';
    ctx.renderView();
  });

  // Status Tabs
  document.querySelectorAll('.gk-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentFilter = btn.dataset.filter || 'all';
      playNav();
      ctx.renderView();
    });
  });

  // View Mode Toggle (Ranked Preview vs Cards)
  document.querySelectorAll('.gk-view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentViewMode = btn.dataset.view || 'preview';
      playNav();
      ctx.renderView();
    });
  });

  // Sort Ranking Dropdown in Preview Mode
  document.getElementById('gk-preview-sort-select')?.addEventListener('change', (e) => {
    _previewSort = e.target.value;
    playNav();
    ctx.renderView();
  });

  // Expand / Collapse All in Preview Mode
  document.getElementById('gk-expand-all-btn')?.addEventListener('click', () => {
    const allCards = Array.from(document.querySelectorAll('.gk-preview-card'));
    const allIds = allCards.map(c => c.dataset.id).filter(Boolean);
    const allExpanded = allIds.length > 0 && allIds.every(id => _expandedItemIds.has(id));
    if (allExpanded) {
      _expandedItemIds.clear();
    } else {
      allIds.forEach(id => _expandedItemIds.add(id));
    }
    playNav();
    ctx.renderView();
  });

  // Preview Row Expansion Toggle (Click anywhere on the preview row or press Enter/Space)
  document.querySelectorAll('.gk-preview-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, select, input, a, .gk-action-btn')) return;
      const id = row.dataset.id;
      if (!id) return;
      if (_expandedItemIds.has(id)) {
        _expandedItemIds.delete(id);
      } else {
        _expandedItemIds.add(id);
      }
      playNav();
      ctx.renderView();
    });

    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const id = row.dataset.id;
        if (!id) return;
        if (_expandedItemIds.has(id)) _expandedItemIds.delete(id);
        else _expandedItemIds.add(id);
        playNav();
        ctx.renderView();
      }
    });
  });

  // Expand / Close Drawer Buttons
  document.querySelectorAll('.gk-row-expand-btn, .gk-close-drawer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      if (_expandedItemIds.has(id)) {
        _expandedItemIds.delete(id);
      } else {
        _expandedItemIds.add(id);
      }
      playNav();
      ctx.renderView();
    });
  });

  // Filter Trigger
  document.querySelectorAll('.gk-filter-pill-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentFilter = btn.dataset.filter || 'all';
      playNav();
      ctx.renderView();
    });
  });

  // Archetype Dropdown
  document.getElementById('gk-archetype-select')?.addEventListener('change', (e) => {
    _currentArchetype = e.target.value;
    playNav();
    ctx.renderView();
  });

  // Search Input
  const searchInput = document.getElementById('gk-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      _searchQuery = e.target.value;
      const cards = document.querySelectorAll('.gk-card, .gk-preview-card');
      const q = _searchQuery.toLowerCase().trim();
      cards.forEach(c => {
        const text = c.textContent.toLowerCase();
        c.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }

  // Clear Search
  document.getElementById('gk-search-clear')?.addEventListener('click', () => {
    _searchQuery = '';
    ctx.renderView();
  });

  // Action Buttons on Cards:
  // 1. Let It Go
  document.querySelectorAll('.gk-letgo-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) await handleItemLetGo(id);
    });
  });

  // 2. Buy & Log Expense
  document.querySelectorAll('.gk-buy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) await handleItemPurchased(id);
    });
  });

  // 3. Extend Cooling +24h
  document.querySelectorAll('.gk-extend-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) await handleItemExtendCooling(id, 24);
    });
  });

  // 4. Unlock Now
  document.querySelectorAll('.gk-unlock-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) await handleItemUnlockNow(id);
    });
  });

  // 5. Move to Future List
  document.querySelectorAll('.gk-future-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      const note = prompt('Add an optional reference note (e.g. wait for sale, birthday, wait for review):') || '';
      await handleItemMoveToFuture(id, note);
    });
  });

  // 6. Move Back from Future List to Cooling Queue
  document.querySelectorAll('.gk-recool-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!id) return;
      await handleItemMoveBackToCooling(id);
    });
  });

  // 7. Delete Item
  document.querySelectorAll('.gk-del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && confirm('Delete this impulse record?')) {
        await deleteGatekeeperItem(id);
        playDelete();
        ctx.renderView();
      }
    });
  });

  // Start Real-Time Live Countdown Ticker
  startCountdownTicker();
}

function startCountdownTicker() {
  if (_countdownInterval) clearInterval(_countdownInterval);

  _countdownInterval = setInterval(() => {
    const timerEls = document.querySelectorAll('.gk-timer-val');
    if (!timerEls || timerEls.length === 0) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
      return;
    }

    let needsRefresh = false;
    timerEls.forEach(el => {
      const unlockAt = el.dataset.unlock;
      const createdAt = el.dataset.created;
      if (!unlockAt) return;

      const { pct, remaining, isReady, formatted } = getCoolingProgress(createdAt, unlockAt);
      el.textContent = `⏳ ${formatted}`;

      const card = el.closest('.gk-card');
      const fill = card?.querySelector('.gk-progress-fill');
      if (fill) fill.style.width = `${pct.toFixed(1)}%`;

      if (isReady && !card?.classList.contains('gk-card-ready')) {
        needsRefresh = true;
      }
    });

    if (needsRefresh) {
      const ctx = getContext();
      if (ctx.renderView) ctx.renderView();
    }
  }, 1000);
}

// ─── Render "+ Log Impulse" Modal Form ────────────────────────────────────────
export function renderLogImpulseModal() {
  const ctx = getContext();
  const categories = ctx.categories && ctx.categories.length > 0
    ? ctx.categories
    : [
        { id: 'shopping', name: 'Shopping', emoji: '🛍️' },
        { id: 'food', name: 'Food', emoji: '🍽️' },
        { id: 'transport', name: 'Transport', emoji: '🧭' },
        { id: 'entertainment', name: 'Entertainment', emoji: '✨' },
        { id: 'other', name: 'Other', emoji: '💫' }
      ];

  const defaultAnswers = {
    frequency: 'Daily (+25)',
    redundancy: 'No (+25)',
    trigger: 'Planned (+25)',
    fit: 'Easy (+25)'
  };
  const initialScore = computeUtilityScore(defaultAnswers);
  const initialTier = getUtilityTier(initialScore);

  return `
  <div class="gk-modal-container">
    <!-- Header -->
    <div class="modal-header">
      <div class="gk-modal-title-wrap">
        <div class="gk-modal-icon">🛡️</div>
        <div>
          <div class="modal-title">Log Impulse Purchase</div>
          <div class="hint-text" style="margin:0">Cool off for 48 hours to separate impulsive dopamine from genuine utility.</div>
        </div>
      </div>
      <button class="modal-close-btn" id="gk-modal-close" aria-label="Close dialog">✕</button>
    </div>

    <!-- Modal Form -->
    <form id="gk-log-form" class="gk-log-form">
      <!-- Section 1: Item & Price -->
      <div class="gk-form-section">
        <div class="form-row" style="display:flex;gap:12px;flex-wrap:wrap">
          <div class="form-group" style="flex:2;min-width:200px">
            <label class="field-label" for="gk-input-name">Item Name *</label>
            <input type="text" id="gk-input-name" class="field-input" placeholder="e.g. Sony WH-1000XM5, Retro Sneakers, Espresso Maker..." required autocomplete="off">
          </div>
          <div class="form-group" style="flex:1;min-width:130px">
            <label class="field-label" for="gk-input-price">Price (₹) *</label>
            <input type="number" id="gk-input-price" class="field-input" placeholder="2999" min="1" step="any" required>
          </div>
        </div>

        <div class="form-row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
          <!-- Budget Category -->
          <div class="form-group" style="flex:1;min-width:160px">
            <label class="field-label" for="gk-select-budget-cat">Budget Category</label>
            <select id="gk-select-budget-cat" class="field-input">
              ${categories.map(c => `
                <option value="${c.name}" ${c.id === 'shopping' ? 'selected' : ''}>
                  ${c.emoji || '🏷️'} ${c.name}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- Cooling Duration -->
          <div class="form-group" style="flex:1;min-width:160px">
            <label class="field-label">Cooling Period</label>
            <select id="gk-select-cooling-hours" class="field-input">
              <option value="24">24 Hours (1 Day)</option>
              <option value="48" selected>48 Hours (Standard — Recommended)</option>
              <option value="72">72 Hours (3 Days — Weekend reflection)</option>
              <option value="168">7 Days (Major investments &gt; ₹5,000)</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Section 2: Gatekeeper Archetype -->
      <div class="gk-form-section">
        <label class="field-label" style="margin-bottom:8px">Gatekeeper Archetype (Impulse Origin) *</label>
        <div class="gk-archetypes-grid">
          ${GATEKEEPER_ARCHETYPES.map((arch, index) => `
            <label class="gk-arch-card ${index === 0 ? 'selected' : ''}" data-arch="${arch.id}">
              <input type="radio" name="gatekeeperCategory" value="${arch.id}" ${index === 0 ? 'checked' : ''} style="display:none">
              <div class="gk-arch-card-top">
                <span class="gk-arch-card-icon">${arch.icon}</span>
                <span class="gk-arch-card-title">${arch.title}</span>
              </div>
              <div class="gk-arch-card-desc">${arch.desc}</div>
            </label>
          `).join('')}
        </div>
      </div>

      <!-- Section 3: Diagnostic 4-Question Assessment -->
      <div class="gk-form-section">
        <!-- Live Meter Banner -->
        <div class="gk-live-meter-card">
          <div class="gk-live-meter-header">
            <div>
              <span class="gk-live-meter-title">Live Diagnostic Utility Score</span>
              <div class="hint-text" style="margin:2px 0 0">Updates in real-time as you answer the diagnostic questions</div>
            </div>
            <div id="gk-modal-score-badge" class="gk-score-pill" style="color:${initialTier.color};background:${initialTier.badgeBg};border-color:${initialTier.borderColor}">
              <strong id="gk-modal-score-num">${initialScore}</strong> / 100 · <span id="gk-modal-tier-label">${initialTier.shortLabel}</span>
            </div>
          </div>
          <div class="gk-score-bar-track" style="margin-top:10px">
            <div id="gk-modal-score-bar" class="gk-score-bar-fill" style="width:${initialScore}%;background:${initialTier.color}"></div>
          </div>
        </div>

        <!-- 4 Questions -->
        <div class="gk-questions-list">
          <!-- Q1: Frequency -->
          <div class="gk-question-box" data-question="frequency">
            <div class="gk-q-header">
              <span class="gk-q-num">1</span>
              <div>
                <div class="gk-q-title">${QUESTION_CONFIG.frequency.title}</div>
                <div class="gk-q-sub">${QUESTION_CONFIG.frequency.prompt}</div>
              </div>
            </div>
            <div class="gk-q-options">
              ${QUESTION_CONFIG.frequency.options.map((opt, i) => `
                <label class="gk-q-opt-pill ${i === 0 ? 'selected' : ''}">
                  <input type="radio" name="q_frequency" value="${opt.value}" ${i === 0 ? 'checked' : ''} style="display:none">
                  <span class="gk-q-opt-icon">${opt.icon}</span>
                  <div class="gk-q-opt-text">
                    <span class="gk-q-opt-val">${opt.title}</span>
                    <span class="gk-q-opt-desc">${opt.desc}</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Q2: Redundancy -->
          <div class="gk-question-box" data-question="redundancy">
            <div class="gk-q-header">
              <span class="gk-q-num">2</span>
              <div>
                <div class="gk-q-title">${QUESTION_CONFIG.redundancy.title}</div>
                <div class="gk-q-sub">${QUESTION_CONFIG.redundancy.prompt}</div>
              </div>
            </div>
            <div class="gk-q-options">
              ${QUESTION_CONFIG.redundancy.options.map((opt, i) => `
                <label class="gk-q-opt-pill ${i === 0 ? 'selected' : ''}">
                  <input type="radio" name="q_redundancy" value="${opt.value}" ${i === 0 ? 'checked' : ''} style="display:none">
                  <span class="gk-q-opt-icon">${opt.icon}</span>
                  <div class="gk-q-opt-text">
                    <span class="gk-q-opt-val">${opt.title}</span>
                    <span class="gk-q-opt-desc">${opt.desc}</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Q3: Emotional Trigger -->
          <div class="gk-question-box" data-question="trigger">
            <div class="gk-q-header">
              <span class="gk-q-num">3</span>
              <div>
                <div class="gk-q-title">${QUESTION_CONFIG.trigger.title}</div>
                <div class="gk-q-sub">${QUESTION_CONFIG.trigger.prompt}</div>
              </div>
            </div>
            <div class="gk-q-options">
              ${QUESTION_CONFIG.trigger.options.map((opt, i) => `
                <label class="gk-q-opt-pill ${i === 0 ? 'selected' : ''}">
                  <input type="radio" name="q_trigger" value="${opt.value}" ${i === 0 ? 'checked' : ''} style="display:none">
                  <span class="gk-q-opt-icon">${opt.icon}</span>
                  <div class="gk-q-opt-text">
                    <span class="gk-q-opt-val">${opt.title}</span>
                    <span class="gk-q-opt-desc">${opt.desc}</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- Q4: Financial Fit -->
          <div class="gk-question-box" data-question="fit">
            <div class="gk-q-header">
              <span class="gk-q-num">4</span>
              <div>
                <div class="gk-q-title">${QUESTION_CONFIG.fit.title}</div>
                <div class="gk-q-sub">${QUESTION_CONFIG.fit.prompt}</div>
              </div>
            </div>
            <div class="gk-q-options">
              ${QUESTION_CONFIG.fit.options.map((opt, i) => `
                <label class="gk-q-opt-pill ${i === 0 ? 'selected' : ''}">
                  <input type="radio" name="q_fit" value="${opt.value}" ${i === 0 ? 'checked' : ''} style="display:none">
                  <span class="gk-q-opt-icon">${opt.icon}</span>
                  <div class="gk-q-opt-text">
                    <span class="gk-q-opt-val">${opt.title}</span>
                    <span class="gk-q-opt-desc">${opt.desc}</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Submit & Cancel Buttons -->
      <div class="modal-footer" style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" class="btn-secondary" id="gk-modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-secondary" id="gk-modal-future-btn" style="border-color:rgba(182, 137, 154, 0.45);color:var(--mauve)" title="Save to Future Reference List without cooling lock">
          📌 Save to Future List
        </button>
        <button type="submit" class="btn-primary" id="gk-modal-submit-btn" style="flex:1;min-width:200px">
          🛡️ Lock in Cooling Queue
        </button>
      </div>
    </form>
  </div>
  `;
}

export function openLogImpulseModal() {
  const ctx = getContext();
  const body = document.getElementById('gatekeeper-modal-body');
  if (body) {
    body.innerHTML = renderLogImpulseModal();
    ctx.openModal('gatekeeper-modal');
    mountLogImpulseModal();
  }
}

export function mountLogImpulseModal() {
  const ctx = getContext();

  // Close handlers
  const close = () => ctx.closeModal('gatekeeper-modal');
  document.getElementById('gk-modal-close')?.addEventListener('click', close);
  document.getElementById('gk-modal-cancel-btn')?.addEventListener('click', close);

  // Archetype radio card selection
  document.querySelectorAll('.gk-arch-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.gk-arch-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });

  // Dynamic Score Updater for the 4 diagnostic questions
  function updateLiveModalScore() {
    const answers = {
      frequency: document.querySelector('input[name="q_frequency"]:checked')?.value || 'Daily (+25)',
      redundancy: document.querySelector('input[name="q_redundancy"]:checked')?.value || 'No (+25)',
      trigger: document.querySelector('input[name="q_trigger"]:checked')?.value || 'Planned (+25)',
      fit: document.querySelector('input[name="q_fit"]:checked')?.value || 'Easy (+25)'
    };

    const score = computeUtilityScore(answers);
    const tier = getUtilityTier(score);

    const scoreNumEl = document.getElementById('gk-modal-score-num');
    const tierLabelEl = document.getElementById('gk-modal-tier-label');
    const badgeEl = document.getElementById('gk-modal-score-badge');
    const barEl = document.getElementById('gk-modal-score-bar');

    if (scoreNumEl) scoreNumEl.textContent = score;
    if (tierLabelEl) tierLabelEl.textContent = tier.shortLabel;
    if (badgeEl) {
      badgeEl.style.color = tier.color;
      badgeEl.style.backgroundColor = tier.badgeBg;
      badgeEl.style.borderColor = tier.borderColor;
    }
    if (barEl) {
      barEl.style.width = `${score}%`;
      barEl.style.backgroundColor = tier.color;
    }
  }

  // Question Option Click Handlers
  document.querySelectorAll('.gk-q-opt-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const parent = pill.closest('.gk-q-options');
      parent?.querySelectorAll('.gk-q-opt-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      const radio = pill.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      updateLiveModalScore();
    });
  });

  // Form Submit Handler
  const form = document.getElementById('gk-log-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('gk-input-name')?.value.trim();
    const price = parseFloat(document.getElementById('gk-input-price')?.value) || 0;
    const gatekeeperCategory = document.querySelector('input[name="gatekeeperCategory"]:checked')?.value || 'Pure Dopamine / Treat';
    const budgetCategory = document.getElementById('gk-select-budget-cat')?.value || 'Shopping';
    const coolingHours = parseInt(document.getElementById('gk-select-cooling-hours')?.value, 10) || 48;

    const answers = {
      frequency: document.querySelector('input[name="q_frequency"]:checked')?.value || 'Daily (+25)',
      redundancy: document.querySelector('input[name="q_redundancy"]:checked')?.value || 'No (+25)',
      trigger: document.querySelector('input[name="q_trigger"]:checked')?.value || 'Planned (+25)',
      fit: document.querySelector('input[name="q_fit"]:checked')?.value || 'Easy (+25)'
    };

    if (!name || price <= 0) {
      alert('Please enter a valid item name and price.');
      return;
    }

    await handleLogImpulse({
      name,
      price,
      gatekeeperCategory,
      budgetCategory,
      coolingHours,
      answers
    });
  });

  // Save directly to Future List handler
  document.getElementById('gk-modal-future-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('gk-input-name')?.value.trim();
    const price = parseFloat(document.getElementById('gk-input-price')?.value) || 0;
    const gatekeeperCategory = document.querySelector('input[name="gatekeeperCategory"]:checked')?.value || 'Pure Dopamine / Treat';
    const budgetCategory = document.getElementById('gk-select-budget-cat')?.value || 'Shopping';
    const coolingHours = parseInt(document.getElementById('gk-select-cooling-hours')?.value, 10) || 48;

    const answers = {
      frequency: document.querySelector('input[name="q_frequency"]:checked')?.value || 'Daily (+25)',
      redundancy: document.querySelector('input[name="q_redundancy"]:checked')?.value || 'No (+25)',
      trigger: document.querySelector('input[name="q_trigger"]:checked')?.value || 'Planned (+25)',
      fit: document.querySelector('input[name="q_fit"]:checked')?.value || 'Easy (+25)'
    };

    if (!name || price <= 0) {
      alert('Please enter a valid item name and price.');
      return;
    }

    const note = prompt('Optional reference note for Future List (e.g. wait for sale, wishlist):') || '';

    await handleLogImpulse({
      name,
      price,
      gatekeeperCategory,
      budgetCategory,
      coolingHours,
      answers,
      initialStatus: 'future',
      futureNote: note
    });
  });
}
