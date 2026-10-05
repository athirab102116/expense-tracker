export const DEFAULT_CATEGORIES = [
  { id: 'food',          name: 'Food',          emoji: '🍔', color: '#FF6B6B' },
  { id: 'groceries',     name: 'Groceries',     emoji: '🛒', color: '#4ECDC4' },
  { id: 'transport',     name: 'Transport',     emoji: '🚗', color: '#45B7D1' },
  { id: 'shopping',      name: 'Shopping',      emoji: '🛍️', color: '#96CEB4' },
  { id: 'bills',         name: 'Bills',         emoji: '📄', color: '#FFEAA7' },
  { id: 'rent',          name: 'Rent',          emoji: '🏠', color: '#DDA0DD' },
  { id: 'entertainment', name: 'Entertainment', emoji: '🎮', color: '#98D8C8' },
  { id: 'health',        name: 'Health',        emoji: '💊', color: '#F7DC6F' },
  { id: 'education',     name: 'Education',     emoji: '📚', color: '#A29BFE' },
  { id: 'travel',        name: 'Travel',        emoji: '✈️', color: '#FD79A8' },
  { id: 'other',         name: 'Other',         emoji: '📦', color: '#B2BEC3' },
];

export const DEFAULT_MERCHANT_RULES = [
  // Food
  { keyword: 'swiggy',      categoryId: 'food' },
  { keyword: 'zomato',      categoryId: 'food' },
  { keyword: 'dominos',     categoryId: 'food' },
  { keyword: 'pizza',       categoryId: 'food' },
  { keyword: 'mcdonald',    categoryId: 'food' },
  { keyword: 'kfc',         categoryId: 'food' },
  { keyword: 'restaurant',  categoryId: 'food' },
  { keyword: 'cafe',        categoryId: 'food' },
  { keyword: 'starbucks',   categoryId: 'food' },
  { keyword: 'blinkit',     categoryId: 'groceries' },
  { keyword: 'zepto',       categoryId: 'groceries' },
  { keyword: 'bigbasket',   categoryId: 'groceries' },
  { keyword: 'dmart',       categoryId: 'groceries' },
  { keyword: 'grofers',     categoryId: 'groceries' },
  { keyword: 'jiomart',     categoryId: 'groceries' },
  // Transport
  { keyword: 'uber',        categoryId: 'transport' },
  { keyword: 'ola',         categoryId: 'transport' },
  { keyword: 'rapido',      categoryId: 'transport' },
  { keyword: 'metro',       categoryId: 'transport' },
  { keyword: 'irctc',       categoryId: 'transport' },
  { keyword: 'makemytrip',  categoryId: 'travel' },
  { keyword: 'indigo',      categoryId: 'travel' },
  { keyword: 'airasia',     categoryId: 'travel' },
  { keyword: 'oyo',         categoryId: 'travel' },
  // Shopping
  { keyword: 'amazon',      categoryId: 'shopping' },
  { keyword: 'flipkart',    categoryId: 'shopping' },
  { keyword: 'myntra',      categoryId: 'shopping' },
  { keyword: 'meesho',      categoryId: 'shopping' },
  { keyword: 'ajio',        categoryId: 'shopping' },
  { keyword: 'nykaa',       categoryId: 'shopping' },
  // Bills / Utilities
  { keyword: 'airtel',      categoryId: 'bills' },
  { keyword: 'jio',         categoryId: 'bills' },
  { keyword: 'vi ',         categoryId: 'bills' },
  { keyword: 'electricity', categoryId: 'bills' },
  { keyword: 'broadband',   categoryId: 'bills' },
  { keyword: 'netflix',     categoryId: 'entertainment' },
  { keyword: 'spotify',     categoryId: 'entertainment' },
  { keyword: 'hotstar',     categoryId: 'entertainment' },
  { keyword: 'prime video', categoryId: 'entertainment' },
  // Health
  { keyword: 'apollo',      categoryId: 'health' },
  { keyword: 'medplus',     categoryId: 'health' },
  { keyword: 'pharmacy',    categoryId: 'health' },
  { keyword: 'hospital',    categoryId: 'health' },
  { keyword: 'clinic',      categoryId: 'health' },
];

export const SMS_PATTERNS = [
  // SBI
  { bank: 'SBI', regex: /(?:INR|Rs\.?)\s*([\d,]+\.?\d*)\s+(?:debited|deducted).*?(?:at|from)\s+(.+?)(?:\s+on|\s*Ref|\s*UPI|$)/i },
  // HDFC
  { bank: 'HDFC', regex: /(?:Rs\.?|INR)\s*([\d,]+\.?\d*)\s+(?:debited|deducted).*?(?:VPA|UPI|at)\s+([A-Za-z0-9@._-]+)/i },
  // ICICI
  { bank: 'ICICI', regex: /(?:INR|Rs\.?)\s*([\d,]+\.?\d*)\s+(?:debited|deducted).*?(?:UPI:|at)\s*([A-Za-z0-9 @._-]+?)(?:\s*on\s*|\s*UPI|$)/i },
  // Axis
  { bank: 'Axis', regex: /(?:INR|Rs\.?)\s*([\d,]+\.?\d*)(?:\s+has been)?\s+(?:debited|deducted).*?(?:to|at|VPA)\s+([A-Za-z0-9@._\- ]+?)(?:\s*on|\s*Ref|$)/i },
  // Kotak
  { bank: 'Kotak', regex: /(?:INR|Rs\.?)\s*([\d,]+\.?\d*)\s+(?:debited|deducted).*?(?:at|to|VPA)\s+(.+?)(?:\s*on|\s*UPI|$)/i },
  // Generic UPI
  { bank: 'Generic UPI', regex: /(?:debited|deducted|paid).*?(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d*).*?(?:to|at|from)\s+([A-Za-z0-9@. -]+?)(?:\s*UPI|\s*Ref|\s*on|$)/i },
  // Generic amount
  { bank: 'Generic', regex: /(?:₹|INR|Rs\.?)\s*([\d,]+\.?\d*)/ },
];
