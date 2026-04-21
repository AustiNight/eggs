/**
 * COUNTABLES — common produce and pantry items sold by count.
 *
 * Used for cross-base unit conversion fallback: when an item is measured
 * in 'each' (or similar count unit) but a recipe calls for grams,
 * typicalEachWeightG bridges the gap.
 *
 * Weights are typical US supermarket specimens (not imported/specialty sizes).
 * Source: USDA FoodData Central published average weights + common grocery knowledge.
 */

export interface CountableEntry {
  /** Canonical single-item name, lowercase. */
  canonicalName: string
  /** Alternative names and plural forms. */
  synonyms: string[]
  /** Typical weight in grams for one unit of this item. */
  typicalEachWeightG: number
  /** Optional link to GPC seed brick. */
  gpcBrickId?: string
}

export const COUNTABLES: CountableEntry[] = [
  // ── Eggs ───────────────────────────────────────────────────────────────────
  {
    canonicalName: 'egg',
    synonyms: ['large egg', "hen's egg", 'chicken egg', 'eggs'],
    typicalEachWeightG: 50,
    gpcBrickId: '10006207',
  },

  // ── Common Fruit ──────────────────────────────────────────────────────────
  {
    canonicalName: 'banana',
    synonyms: ['bananas', 'ripe banana'],
    typicalEachWeightG: 118,
    gpcBrickId: '10006400',
  },
  {
    canonicalName: 'apple',
    synonyms: ['apples', 'medium apple', 'gala apple', 'fuji apple', 'honeycrisp apple'],
    typicalEachWeightG: 182,
    gpcBrickId: '10006401',
  },
  {
    canonicalName: 'orange',
    synonyms: ['oranges', 'navel orange', 'medium orange'],
    typicalEachWeightG: 150,
    gpcBrickId: '10006402',
  },
  {
    canonicalName: 'lemon',
    synonyms: ['lemons', 'medium lemon'],
    typicalEachWeightG: 58,
  },
  {
    canonicalName: 'lime',
    synonyms: ['limes', 'persian lime'],
    typicalEachWeightG: 44,
  },
  {
    canonicalName: 'avocado',
    synonyms: ['avocados', 'hass avocado', 'medium avocado'],
    typicalEachWeightG: 200,
    gpcBrickId: '10006405',
  },
  {
    canonicalName: 'kiwi',
    synonyms: ['kiwis', 'kiwifruit', 'kiwi fruit'],
    typicalEachWeightG: 76,
  },
  {
    canonicalName: 'strawberry',
    synonyms: ['strawberries', 'large strawberry'],
    typicalEachWeightG: 12,
    gpcBrickId: '10006403',
  },
  {
    canonicalName: 'raspberry',
    synonyms: ['raspberries'],
    typicalEachWeightG: 3,
  },
  {
    canonicalName: 'blueberry',
    synonyms: ['blueberries'],
    typicalEachWeightG: 1,
    gpcBrickId: '10006404',
  },

  // ── Common Vegetables ─────────────────────────────────────────────────────
  {
    canonicalName: 'tomato',
    synonyms: ['tomatoes', 'medium tomato', 'round tomato', 'vine tomato'],
    typicalEachWeightG: 150,
    gpcBrickId: '10006406',
  },
  {
    canonicalName: 'onion',
    synonyms: ['onions', 'medium onion', 'yellow onion', 'white onion'],
    typicalEachWeightG: 150,
    gpcBrickId: '10006408',
  },
  {
    canonicalName: 'potato',
    synonyms: ['potatoes', 'medium potato', 'russet potato', 'baking potato'],
    typicalEachWeightG: 170,
    gpcBrickId: '10006407',
  },
  {
    canonicalName: 'sweet potato',
    synonyms: ['sweet potatoes', 'yam', 'medium sweet potato'],
    typicalEachWeightG: 150,
    // gpcBrickId intentionally omitted: sweet potato is a distinct GPC category
    // from '10006407' (Potatoes). Pending Jonathan's review to assign a verified
    // GS1 GPC brick code from https://gpc-browser.gs1.org/
  },
  {
    canonicalName: 'bell pepper',
    synonyms: ['bell peppers', 'medium bell pepper', 'green pepper', 'red pepper'],
    typicalEachWeightG: 119,
    gpcBrickId: '10006413',
  },
  {
    canonicalName: 'jalapeño',
    synonyms: ['jalapeno', 'jalapeños', 'jalapenos', 'fresh jalapeño'],
    typicalEachWeightG: 14,
  },
  {
    canonicalName: 'cucumber',
    synonyms: ['cucumbers', 'english cucumber', 'medium cucumber'],
    typicalEachWeightG: 300,
  },
  {
    canonicalName: 'carrot',
    synonyms: ['carrots', 'medium carrot', 'whole carrot'],
    typicalEachWeightG: 61,
    gpcBrickId: '10006412',
  },
  {
    canonicalName: 'zucchini',
    synonyms: ['zucchinis', 'courgette', 'medium zucchini'],
    typicalEachWeightG: 200,
  },
  {
    canonicalName: 'ear of corn',
    synonyms: ['corn on the cob', 'corn ear', 'cob of corn'],
    typicalEachWeightG: 120,
  },
  {
    canonicalName: 'mushroom',
    synonyms: ['mushrooms', 'button mushroom', 'white mushroom', 'cremini mushroom'],
    typicalEachWeightG: 10,
  },

  // ── Bulb / Allium ─────────────────────────────────────────────────────────
  {
    canonicalName: 'clove of garlic',
    synonyms: ['garlic clove', 'garlic cloves', 'single garlic clove'],
    typicalEachWeightG: 4,
    gpcBrickId: '10006409',
  },

  // ── Head / Bunch produce ──────────────────────────────────────────────────
  {
    canonicalName: 'head of lettuce',
    synonyms: ['lettuce head', 'head lettuce', 'iceberg head', 'romaine head'],
    typicalEachWeightG: 600,
    gpcBrickId: '10006410',
  },
  {
    canonicalName: 'head of cabbage',
    synonyms: ['cabbage head', 'green cabbage', 'medium head of cabbage'],
    typicalEachWeightG: 900,
  },
  {
    canonicalName: 'head of broccoli',
    synonyms: ['broccoli crown', 'broccoli head', 'bunch of broccoli'],
    typicalEachWeightG: 500,
    gpcBrickId: '10006411',
  },
  {
    canonicalName: 'head of cauliflower',
    synonyms: ['cauliflower head', 'whole cauliflower'],
    typicalEachWeightG: 1000,
  },
  {
    canonicalName: 'bunch of celery',
    synonyms: ['celery bunch', 'stalk of celery', 'head of celery'],
    typicalEachWeightG: 500,
    gpcBrickId: '10006414',
  },
  {
    canonicalName: 'bunch of scallions',
    synonyms: ['scallions', 'green onions', 'spring onions', 'bunch of green onions'],
    typicalEachWeightG: 80,
  },
  {
    canonicalName: 'peach',
    synonyms: ['peaches', 'medium peach', 'fresh peach'],
    typicalEachWeightG: 150,
  },
]
