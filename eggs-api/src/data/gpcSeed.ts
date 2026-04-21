/**
 * GS1 GPC (Global Product Classification) seed data.
 *
 * IMPORTANT — REVIEW REQUIRED:
 * GPC brick codes in this file are hand-curated approximations.
 * The format follows GS1 GPC schema but the numeric IDs below are
 * *placeholder IDs* derived from public GS1 GPC browser structure.
 * Jonathan must review and swap in verified codes from:
 *   https://gpc-browser.gs1.org/
 *
 * Hierarchy: Segment → Family → Class → Brick
 * parent field: null = top-level segment, otherwise the id of the parent node.
 *
 * Coverage: ~90 entries across highest-traffic US grocery categories.
 */

export interface GpcNode {
  id: string
  label: string
  parent: string | null
  synonyms: string[]
}

export const GPC_SEED: Record<string, GpcNode> = {

  // ── SEGMENT: Food/Beverage/Tobacco ─────────────────────────────────────────
  '50000000': {
    id: '50000000',
    label: 'Food/Beverage/Tobacco',
    parent: null,
    synonyms: ['grocery', 'food', 'beverage'],
  },

  // ── FAMILY: Beverages ───────────────────────────────────────────────────────
  '50180000': {
    id: '50180000',
    label: 'Beverages (Non-Alcoholic)',
    parent: '50000000',
    synonyms: ['drinks', 'non-alcoholic beverages'],
  },
  // Classes within Beverages
  '50181500': {
    id: '50181500',
    label: 'Milk',
    parent: '50180000',
    synonyms: ['dairy milk', 'cow milk'],
  },
  // Bricks within Milk
  '10005618': {
    id: '10005618',
    label: 'Milk - Whole',
    parent: '50181500',
    synonyms: ['whole milk', 'full fat milk', '3.25%'],
  },
  '10005619': {
    id: '10005619',
    label: 'Milk - 2% Reduced Fat',
    parent: '50181500',
    synonyms: ['2% milk', 'reduced fat milk', 'low fat milk'],
  },
  '10005620': {
    id: '10005620',
    label: 'Milk - 1% Low Fat',
    parent: '50181500',
    synonyms: ['1% milk', '1 percent milk'],
  },
  '10005621': {
    id: '10005621',
    label: 'Milk - Skim/Fat Free',
    parent: '50181500',
    synonyms: ['skim milk', 'fat free milk', 'nonfat milk', '0% milk'],
  },
  '10005622': {
    id: '10005622',
    label: 'Milk - Lactose Free',
    parent: '50181500',
    synonyms: ['lactose free milk', 'lactaid'],
  },
  // Juice
  '50181600': {
    id: '50181600',
    label: 'Juice',
    parent: '50180000',
    synonyms: ['fruit juice', '100% juice'],
  },
  '10005700': {
    id: '10005700',
    label: 'Orange Juice',
    parent: '50181600',
    synonyms: ['oj', 'fresh squeezed oj', 'orange juice concentrate'],
  },
  '10005701': {
    id: '10005701',
    label: 'Apple Juice/Cider',
    parent: '50181600',
    synonyms: ['apple juice', 'apple cider', 'apple drink'],
  },
  '10005702': {
    id: '10005702',
    label: 'Grape Juice',
    parent: '50181600',
    synonyms: ['grape juice', 'grape drink'],
  },
  // Soda / Carbonated
  '50181700': {
    id: '50181700',
    label: 'Carbonated Soft Drinks',
    parent: '50180000',
    synonyms: ['soda', 'pop', 'coke', 'cola', 'carbonated beverages'],
  },
  '10005800': {
    id: '10005800',
    label: 'Cola',
    parent: '50181700',
    synonyms: ['coca-cola', 'pepsi', 'cola drinks'],
  },
  '10005801': {
    id: '10005801',
    label: 'Lemon-Lime Soda',
    parent: '50181700',
    synonyms: ['sprite', '7up', 'sierra mist', 'lemon lime soda'],
  },
  // Water
  '50181800': {
    id: '50181800',
    label: 'Water',
    parent: '50180000',
    synonyms: ['bottled water', 'drinking water'],
  },
  '10005900': {
    id: '10005900',
    label: 'Still Water',
    parent: '50181800',
    synonyms: ['still water', 'spring water', 'purified water'],
  },
  '10005901': {
    id: '10005901',
    label: 'Sparkling Water',
    parent: '50181800',
    synonyms: ['sparkling water', 'seltzer', 'club soda', 'carbonated water'],
  },
  // Coffee / Tea
  '50181900': {
    id: '50181900',
    label: 'Coffee',
    parent: '50180000',
    synonyms: ['coffee beans', 'ground coffee', 'instant coffee'],
  },
  '10006000': {
    id: '10006000',
    label: 'Ground Coffee',
    parent: '50181900',
    synonyms: ['ground coffee', 'drip coffee', 'filter coffee'],
  },
  '10006001': {
    id: '10006001',
    label: 'Whole Bean Coffee',
    parent: '50181900',
    synonyms: ['whole bean', 'whole coffee beans'],
  },
  '50182000': {
    id: '50182000',
    label: 'Tea',
    parent: '50180000',
    synonyms: ['tea bags', 'loose leaf tea', 'herbal tea'],
  },
  '10006100': {
    id: '10006100',
    label: 'Black Tea',
    parent: '50182000',
    synonyms: ['black tea', 'english breakfast', 'earl grey'],
  },
  '10006101': {
    id: '10006101',
    label: 'Green Tea',
    parent: '50182000',
    synonyms: ['green tea', 'matcha'],
  },

  // ── FAMILY: Dairy ───────────────────────────────────────────────────────────
  '50160000': {
    id: '50160000',
    label: 'Dairy Products',
    parent: '50000000',
    synonyms: ['dairy', 'dairy section'],
  },
  '10006200': {
    id: '10006200',
    label: 'Cheese - Natural',
    parent: '50160000',
    synonyms: ['natural cheese', 'block cheese', 'sliced cheese', 'shredded cheese'],
  },
  '10006201': {
    id: '10006201',
    label: 'Cheese - Processed',
    parent: '50160000',
    synonyms: ['american cheese', 'velveeta', 'processed cheese'],
  },
  '10006202': {
    id: '10006202',
    label: 'Yogurt',
    parent: '50160000',
    synonyms: ['yogurt', 'yoghurt', 'greek yogurt', 'whole milk yogurt'],
  },
  '10006203': {
    id: '10006203',
    label: 'Butter',
    parent: '50160000',
    synonyms: ['butter', 'unsalted butter', 'salted butter', 'stick butter'],
  },
  '10006204': {
    id: '10006204',
    label: 'Margarine / Spreads',
    parent: '50160000',
    synonyms: ['margarine', 'butter spread', 'vegetable spread'],
  },
  '10006205': {
    id: '10006205',
    label: 'Cream',
    parent: '50160000',
    synonyms: ['heavy cream', 'heavy whipping cream', 'light cream', 'half and half'],
  },
  '10006206': {
    id: '10006206',
    label: 'Sour Cream',
    parent: '50160000',
    synonyms: ['sour cream', 'creme fraiche'],
  },
  '10006207': {
    id: '10006207',
    label: 'Eggs',
    parent: '50160000',
    synonyms: ['eggs', 'large eggs', 'white eggs', 'brown eggs', 'dozen eggs'],
  },
  '10006208': {
    id: '10006208',
    label: 'Cream Cheese',
    parent: '50160000',
    synonyms: ['cream cheese', 'neufchatel'],
  },
  '10006209': {
    id: '10006209',
    label: 'Cottage Cheese',
    parent: '50160000',
    synonyms: ['cottage cheese', 'small curd cottage cheese'],
  },

  // ── FAMILY: Meat / Poultry / Seafood ────────────────────────────────────────
  '50110000': {
    id: '50110000',
    label: 'Meat/Poultry/Seafood',
    parent: '50000000',
    synonyms: ['meat', 'protein', 'poultry', 'seafood', 'fish'],
  },
  '10006300': {
    id: '10006300',
    label: 'Beef - Ground',
    parent: '50110000',
    synonyms: ['ground beef', 'hamburger meat', '80/20', '90/10'],
  },
  '10006301': {
    id: '10006301',
    label: 'Beef - Steak',
    parent: '50110000',
    synonyms: ['steak', 'ribeye', 'sirloin', 'new york strip', 't-bone', 'filet mignon'],
  },
  '10006302': {
    id: '10006302',
    label: 'Beef - Roast',
    parent: '50110000',
    synonyms: ['chuck roast', 'beef roast', 'pot roast', 'brisket'],
  },
  '10006303': {
    id: '10006303',
    label: 'Chicken - Whole',
    parent: '50110000',
    synonyms: ['whole chicken', 'fryer', 'rotisserie chicken'],
  },
  '10006304': {
    id: '10006304',
    label: 'Chicken - Breasts',
    parent: '50110000',
    synonyms: ['chicken breast', 'chicken breasts', 'boneless skinless chicken breast'],
  },
  '10006305': {
    id: '10006305',
    label: 'Chicken - Thighs',
    parent: '50110000',
    synonyms: ['chicken thighs', 'boneless chicken thighs', 'bone-in thighs'],
  },
  '10006306': {
    id: '10006306',
    label: 'Pork - Chops',
    parent: '50110000',
    synonyms: ['pork chops', 'pork loin chops', 'pork rib chops'],
  },
  '10006307': {
    id: '10006307',
    label: 'Pork - Ground',
    parent: '50110000',
    synonyms: ['ground pork', 'pork sausage ground'],
  },
  '10006308': {
    id: '10006308',
    label: 'Pork - Bacon',
    parent: '50110000',
    synonyms: ['bacon', 'pork bacon', 'thick cut bacon', 'center cut bacon'],
  },
  '10006309': {
    id: '10006309',
    label: 'Sausage',
    parent: '50110000',
    synonyms: ['sausage', 'italian sausage', 'breakfast sausage', 'bratwurst'],
  },
  '10006310': {
    id: '10006310',
    label: 'Fish - Fresh/Frozen',
    parent: '50110000',
    synonyms: ['fish', 'salmon', 'tilapia', 'cod', 'catfish', 'mahi mahi'],
  },
  '10006311': {
    id: '10006311',
    label: 'Shrimp',
    parent: '50110000',
    synonyms: ['shrimp', 'frozen shrimp', 'raw shrimp', 'cooked shrimp'],
  },

  // ── FAMILY: Produce ─────────────────────────────────────────────────────────
  '50130000': {
    id: '50130000',
    label: 'Fresh Produce',
    parent: '50000000',
    synonyms: ['produce', 'fruits', 'vegetables', 'fresh fruits and vegetables'],
  },
  '10006400': {
    id: '10006400',
    label: 'Bananas',
    parent: '50130000',
    synonyms: ['banana', 'bananas', 'ripe bananas', 'plantains'],
  },
  '10006401': {
    id: '10006401',
    label: 'Apples',
    parent: '50130000',
    synonyms: ['apple', 'apples', 'gala', 'fuji', 'granny smith', 'honeycrisp'],
  },
  '10006402': {
    id: '10006402',
    label: 'Oranges',
    parent: '50130000',
    synonyms: ['orange', 'oranges', 'navel orange', 'mandarin'],
  },
  '10006403': {
    id: '10006403',
    label: 'Strawberries',
    parent: '50130000',
    synonyms: ['strawberry', 'strawberries'],
  },
  '10006404': {
    id: '10006404',
    label: 'Blueberries',
    parent: '50130000',
    synonyms: ['blueberry', 'blueberries'],
  },
  '10006405': {
    id: '10006405',
    label: 'Avocados',
    parent: '50130000',
    synonyms: ['avocado', 'avocados', 'hass avocado'],
  },
  '10006406': {
    id: '10006406',
    label: 'Tomatoes',
    parent: '50130000',
    synonyms: ['tomato', 'tomatoes', 'roma tomato', 'cherry tomato', 'beefsteak tomato'],
  },
  '10006407': {
    id: '10006407',
    label: 'Potatoes',
    parent: '50130000',
    synonyms: ['potato', 'potatoes', 'russet potato', 'yukon gold', 'red potato'],
  },
  '10006408': {
    id: '10006408',
    label: 'Onions',
    parent: '50130000',
    synonyms: ['onion', 'onions', 'yellow onion', 'white onion', 'red onion'],
  },
  '10006409': {
    id: '10006409',
    label: 'Garlic',
    parent: '50130000',
    synonyms: ['garlic', 'garlic bulb', 'garlic head', 'garlic cloves'],
  },
  '10006410': {
    id: '10006410',
    label: 'Lettuce',
    parent: '50130000',
    synonyms: ['lettuce', 'romaine', 'iceberg lettuce', 'green leaf', 'head of lettuce'],
  },
  '10006411': {
    id: '10006411',
    label: 'Broccoli',
    parent: '50130000',
    synonyms: ['broccoli', 'broccoli florets', 'head of broccoli'],
  },
  '10006412': {
    id: '10006412',
    label: 'Carrots',
    parent: '50130000',
    synonyms: ['carrot', 'carrots', 'baby carrots', 'whole carrots'],
  },
  '10006413': {
    id: '10006413',
    label: 'Bell Peppers',
    parent: '50130000',
    synonyms: ['bell pepper', 'bell peppers', 'green pepper', 'red pepper', 'yellow pepper'],
  },
  '10006414': {
    id: '10006414',
    label: 'Celery',
    parent: '50130000',
    synonyms: ['celery', 'bunch of celery', 'celery stalks'],
  },
  '10006415': {
    id: '10006415',
    label: 'Spinach',
    parent: '50130000',
    synonyms: ['spinach', 'baby spinach', 'fresh spinach'],
  },
  '10006416': {
    id: '10006416',
    label: 'Fresh Herbs',
    parent: '50130000',
    synonyms: ['herbs', 'cilantro', 'parsley', 'basil', 'mint', 'rosemary', 'thyme'],
  },

  // ── FAMILY: Bread/Bakery ─────────────────────────────────────────────────────
  '50140000': {
    id: '50140000',
    label: 'Bread/Bakery',
    parent: '50000000',
    synonyms: ['bread', 'baked goods', 'bakery'],
  },
  '10006500': {
    id: '10006500',
    label: 'Sliced Sandwich Bread',
    parent: '50140000',
    synonyms: ['bread', 'white bread', 'wheat bread', 'sandwich bread', 'sliced bread'],
  },
  '10006501': {
    id: '10006501',
    label: 'Rolls / Buns',
    parent: '50140000',
    synonyms: ['buns', 'rolls', 'hamburger buns', 'hot dog buns', 'dinner rolls'],
  },
  '10006502': {
    id: '10006502',
    label: 'Tortillas',
    parent: '50140000',
    synonyms: ['tortillas', 'flour tortillas', 'corn tortillas', 'wraps'],
  },
  '10006503': {
    id: '10006503',
    label: 'Bagels',
    parent: '50140000',
    synonyms: ['bagels', 'plain bagel', 'everything bagel'],
  },
  '10006504': {
    id: '10006504',
    label: 'Muffins',
    parent: '50140000',
    synonyms: ['muffins', 'blueberry muffins', 'bran muffins'],
  },

  // ── FAMILY: Dry Goods / Pasta / Rice / Grains ────────────────────────────────
  '50150000': {
    id: '50150000',
    label: 'Dry Goods / Grains / Pasta',
    parent: '50000000',
    synonyms: ['dry goods', 'pantry staples', 'grains', 'pasta', 'rice', 'flour'],
  },
  '10006600': {
    id: '10006600',
    label: 'Pasta - Dry',
    parent: '50150000',
    synonyms: ['pasta', 'spaghetti', 'penne', 'fettuccine', 'rigatoni', 'linguine', 'rotini'],
  },
  '10006601': {
    id: '10006601',
    label: 'Rice',
    parent: '50150000',
    synonyms: ['rice', 'white rice', 'brown rice', 'jasmine rice', 'basmati rice', 'long grain rice'],
  },
  '10006602': {
    id: '10006602',
    label: 'All-Purpose Flour',
    parent: '50150000',
    synonyms: ['flour', 'all purpose flour', 'ap flour', 'white flour'],
  },
  '10006603': {
    id: '10006603',
    label: 'Sugar',
    parent: '50150000',
    synonyms: ['sugar', 'white sugar', 'granulated sugar', 'cane sugar'],
  },
  '10006604': {
    id: '10006604',
    label: 'Oats / Oatmeal',
    parent: '50150000',
    synonyms: ['oats', 'oatmeal', 'rolled oats', 'quick oats', 'steel cut oats'],
  },

  // ── FAMILY: Frozen Foods ─────────────────────────────────────────────────────
  '50170000': {
    id: '50170000',
    label: 'Frozen Foods',
    parent: '50000000',
    synonyms: ['frozen', 'frozen section', 'frozen meals'],
  },
  '10006700': {
    id: '10006700',
    label: 'Frozen Entrees / Meals',
    parent: '50170000',
    synonyms: ['frozen dinners', 'frozen meals', 'tv dinners', 'microwave meals'],
  },
  '10006701': {
    id: '10006701',
    label: 'Frozen Vegetables',
    parent: '50170000',
    synonyms: ['frozen vegetables', 'frozen peas', 'frozen corn', 'frozen broccoli'],
  },
  '10006702': {
    id: '10006702',
    label: 'Frozen Fruit',
    parent: '50170000',
    synonyms: ['frozen fruit', 'frozen berries', 'frozen strawberries', 'frozen mango'],
  },
  '10006703': {
    id: '10006703',
    label: 'Ice Cream',
    parent: '50170000',
    synonyms: ['ice cream', 'ice cream pint', 'ice cream half gallon'],
  },
  '10006704': {
    id: '10006704',
    label: 'Frozen Pizza',
    parent: '50170000',
    synonyms: ['frozen pizza', 'pizza', 'personal pizza'],
  },
  '10006705': {
    id: '10006705',
    label: 'Frozen Breakfast Items',
    parent: '50170000',
    synonyms: ['frozen waffles', 'frozen pancakes', 'frozen breakfast burritos'],
  },

  // ── FAMILY: Canned / Jarred ──────────────────────────────────────────────────
  '50155000': {
    id: '50155000',
    label: 'Canned/Jarred Foods',
    parent: '50000000',
    synonyms: ['canned goods', 'canned food', 'jarred food'],
  },
  '10006800': {
    id: '10006800',
    label: 'Canned Tomatoes / Tomato Sauce',
    parent: '50155000',
    synonyms: ['canned tomatoes', 'tomato sauce', 'crushed tomatoes', 'diced tomatoes', 'tomato paste'],
  },
  '10006801': {
    id: '10006801',
    label: 'Canned Beans',
    parent: '50155000',
    synonyms: ['canned beans', 'black beans', 'kidney beans', 'chickpeas', 'garbanzo beans', 'pinto beans'],
  },
  '10006802': {
    id: '10006802',
    label: 'Canned Soups',
    parent: '50155000',
    synonyms: ['canned soup', 'soup', 'chicken noodle soup', 'tomato soup'],
  },
  '10006803': {
    id: '10006803',
    label: 'Canned Tuna/Salmon',
    parent: '50155000',
    synonyms: ['canned tuna', 'canned fish', 'tuna can', 'canned salmon'],
  },
  '10006804': {
    id: '10006804',
    label: 'Canned Corn/Green Beans/Peas',
    parent: '50155000',
    synonyms: ['canned vegetables', 'canned corn', 'canned green beans', 'canned peas'],
  },
  '10006805': {
    id: '10006805',
    label: 'Pasta Sauce (Jarred)',
    parent: '50155000',
    synonyms: ['pasta sauce', 'marinara', 'jarred pasta sauce', 'spaghetti sauce'],
  },
  '10006806': {
    id: '10006806',
    label: 'Salsa (Jarred)',
    parent: '50155000',
    synonyms: ['salsa', 'pico de gallo', 'jarred salsa'],
  },

  // ── FAMILY: Condiments / Sauces ──────────────────────────────────────────────
  '50156000': {
    id: '50156000',
    label: 'Condiments/Sauces',
    parent: '50000000',
    synonyms: ['condiments', 'sauces', 'dressings', 'spreads'],
  },
  '10006900': {
    id: '10006900',
    label: 'Ketchup',
    parent: '50156000',
    synonyms: ['ketchup', 'catsup', 'tomato ketchup'],
  },
  '10006901': {
    id: '10006901',
    label: 'Mustard',
    parent: '50156000',
    synonyms: ['mustard', 'yellow mustard', 'dijon mustard', 'spicy brown mustard'],
  },
  '10006902': {
    id: '10006902',
    label: 'Mayonnaise',
    parent: '50156000',
    synonyms: ['mayonnaise', 'mayo', 'sandwich spread'],
  },
  '10006903': {
    id: '10006903',
    label: 'Salad Dressing',
    parent: '50156000',
    synonyms: ['salad dressing', 'ranch', 'italian dressing', 'caesar dressing', 'vinaigrette'],
  },
  '10006904': {
    id: '10006904',
    label: 'Hot Sauce',
    parent: '50156000',
    synonyms: ['hot sauce', 'sriracha', 'tabasco', 'franks red hot'],
  },
  '10006905': {
    id: '10006905',
    label: 'Soy Sauce',
    parent: '50156000',
    synonyms: ['soy sauce', 'tamari', 'low sodium soy sauce'],
  },

  // ── FAMILY: Snacks ───────────────────────────────────────────────────────────
  '50157000': {
    id: '50157000',
    label: 'Snacks',
    parent: '50000000',
    synonyms: ['snacks', 'chips', 'crackers', 'nuts', 'snack foods'],
  },
  '10007000': {
    id: '10007000',
    label: 'Potato Chips',
    parent: '50157000',
    synonyms: ['chips', 'potato chips', 'kettle chips'],
  },
  '10007001': {
    id: '10007001',
    label: 'Tortilla Chips',
    parent: '50157000',
    synonyms: ['tortilla chips', 'corn chips', 'nacho chips', 'doritos'],
  },
  '10007002': {
    id: '10007002',
    label: 'Crackers',
    parent: '50157000',
    synonyms: ['crackers', 'saltines', 'ritz', 'wheat thins', 'triscuits'],
  },
  '10007003': {
    id: '10007003',
    label: 'Pretzels',
    parent: '50157000',
    synonyms: ['pretzels', 'pretzel sticks', 'pretzel nuggets'],
  },
  '10007004': {
    id: '10007004',
    label: 'Nuts / Trail Mix',
    parent: '50157000',
    synonyms: ['nuts', 'trail mix', 'almonds', 'peanuts', 'cashews', 'mixed nuts'],
  },
  '10007005': {
    id: '10007005',
    label: 'Popcorn',
    parent: '50157000',
    synonyms: ['popcorn', 'microwave popcorn', 'bagged popcorn'],
  },
  '10007006': {
    id: '10007006',
    label: 'Granola Bars / Snack Bars',
    parent: '50157000',
    synonyms: ['granola bars', 'snack bars', 'protein bars', 'energy bars', 'kind bars', 'clif bars'],
  },

  // ── FAMILY: Breakfast Cereals ────────────────────────────────────────────────
  '50158000': {
    id: '50158000',
    label: 'Breakfast Cereals',
    parent: '50000000',
    synonyms: ['cereal', 'breakfast cereal', 'cold cereal', 'hot cereal'],
  },
  '10007100': {
    id: '10007100',
    label: 'Cold Cereal',
    parent: '50158000',
    synonyms: ['cereal', 'corn flakes', 'cheerios', 'frosted flakes', 'rice krispies'],
  },
  '10007101': {
    id: '10007101',
    label: 'Granola',
    parent: '50158000',
    synonyms: ['granola', 'muesli'],
  },

  // ── FAMILY: Baking Supplies ──────────────────────────────────────────────────
  '50159000': {
    id: '50159000',
    label: 'Baking Supplies',
    parent: '50000000',
    synonyms: ['baking', 'baking supplies', 'baking ingredients'],
  },
  '10007200': {
    id: '10007200',
    label: 'Baking Powder / Baking Soda',
    parent: '50159000',
    synonyms: ['baking powder', 'baking soda', 'sodium bicarbonate'],
  },
  '10007201': {
    id: '10007201',
    label: 'Yeast',
    parent: '50159000',
    synonyms: ['yeast', 'active dry yeast', 'instant yeast', 'bread yeast'],
  },
  '10007202': {
    id: '10007202',
    label: 'Chocolate Chips / Baking Chocolate',
    parent: '50159000',
    synonyms: ['chocolate chips', 'baking chocolate', 'semi-sweet chocolate', 'cocoa powder'],
  },
  '10007203': {
    id: '10007203',
    label: 'Vanilla Extract',
    parent: '50159000',
    synonyms: ['vanilla extract', 'pure vanilla', 'imitation vanilla'],
  },
  '10007204': {
    id: '10007204',
    label: 'Brown Sugar',
    parent: '50159000',
    synonyms: ['brown sugar', 'light brown sugar', 'dark brown sugar'],
  },
  '10007205': {
    id: '10007205',
    label: 'Powdered Sugar',
    parent: '50159000',
    synonyms: ['powdered sugar', 'confectioners sugar', 'icing sugar'],
  },
}
