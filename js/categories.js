export const DEFAULT_CATEGORIES = [
  { id: 'food',          name: 'Food',          emoji: '🍓', color: '#ff7878' },  // coral red    ~0°
  { id: 'health',        name: 'Health',        emoji: '🌺', color: '#ffb870' },  // peach orange ~25°
  { id: 'bills',         name: 'Bills',         emoji: '⭐', color: '#f8e060' },  // golden yellow ~55°
  { id: 'groceries',     name: 'Groceries',     emoji: '🌿', color: '#a8e870' },  // lime green   ~80°
  { id: 'other',         name: 'Other',         emoji: '✨', color: '#78e898' },  // mint green   ~140°
  { id: 'entertainment', name: 'Entertainment', emoji: '🎠', color: '#60ddd0' },  // teal         ~175°
  { id: 'transport',     name: 'Transport',     emoji: '🦋', color: '#70b8f8' },  // sky blue     ~205°
  { id: 'education',     name: 'Education',     emoji: '🔮', color: '#8898f8' },  // periwinkle   ~230°
  { id: 'rent',          name: 'Rent',          emoji: '🏡', color: '#b888f8' },  // soft violet  ~270°
  { id: 'travel',        name: 'Travel',        emoji: '🌙', color: '#e060e8' },  // magenta      ~295°
  { id: 'shopping',      name: 'Shopping',      emoji: '🌸', color: '#f870b8' },  // hot pink     ~330°
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

