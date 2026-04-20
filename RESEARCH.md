# RESEARCH.md — Ontology & Disambiguation Pattern Evaluation

**Date:** 2026-04-20
**Phase:** 1 (research — no code)
**Inputs:** Phase 1 research briefs on FoodOn / FoodKG, USDA FoodData Central / Open Food Facts, lighter alternatives, and disambiguation interaction patterns.

---

## 1. Executive Summary

### 1.1 Recommendation — Layered Hybrid (zero-cost, edge-friendly)

Use **no single "backbone" ontology.** Compose three low-cost layers the MVP actually needs:

| Layer | Role | Source | Runtime |
|---|---|---|---|
| **A. Category taxonomy** | Deterministic is-a for disambiguation branching ("dairy → milk → whole milk") | Hand-curated TS tree seeded from GS1 GPC Brick codes (~150 entries) | Bundled in Worker |
| **B. Branded SKU + UoM ground truth** | Authoritative "does this real product exist at this size?" | USDA FoodData Central **Branded Foods** API (CC0, 1000 req/hr free) | Remote fetch + KV cache |
| **C. Enrichment tags (dietary, allergens, NOVA, category synonyms)** | Substitution hooks and clarification option generation | Open Food Facts (already in repo, US-filtered slice) | Remote fetch + KV cache |

**Wire format:** Instacart's public `LineItem` schema shape (`name`, optional `display_text`, optional `upc`, `measurements[]`). Schema.org `Product` alignment for external compatibility.

**Resolution flow:** retrieval-grounded — run a cheap Kroger/Walmart/USDA pre-search on the partial parse, then synthesize 2–4 clarification options from the distinguishing attributes of the actual top candidates (not from Claude's imagination). This was the Phase 1 highest-leverage pattern finding (ProductAgent, arXiv 2407.00942).

**LLM loop:** two-tool pattern via Claude `tool_choice: "any"` — `ask_clarification` and `finalize_item`. Loop terminates when `finalize_item` fires. Hard cap at 3 turns, then force-finalize with `confidence: low`.

### 1.2 Three Biggest Tradeoffs

1. **We carry three data sources instead of one.** A single ontology would be conceptually cleaner, but none of the big four (FoodOn, FoodKG, USDA FDC, OFF) solves all three of branded coverage + UoM + deep taxonomy at zero cost with edge-runnable size. Composing them is the only honest MVP answer. The cost is a thin mapping layer we own.
2. **GS1 GPC Bricks give us a free, standards-aligned category spine without licensing friction, but we must hand-curate the specific slice we care about.** Roughly 150 entries covers ~95% of a grocery MVP. That's an afternoon of work but real work, and it drifts from retail reality over time.
3. **Retrieval-grounded clarification requires a cheap pre-search on partial parses, which burns API budget before the user has finished clarifying.** We pay in Kroger/Walmart quota and latency. Mitigation: a two-tier resolution cache keyed on normalized strings, so repeat items across users short-circuit the pre-search entirely.

### 1.3 Runner-Up — FoodOn + USDA FDC + OFF, fully layered

FoodOn is actively maintained (latest release 2025-07-31, CC-BY-4.0), with a clean is-a hierarchy and an existing substitution relation (`has food substance analog`). A preprocessed subset (labels + synonyms + is_a tree, maybe ~3–5 MB compressed) served from R2 or KV is edge-runnable. This is the more "proper" ontology answer — but the custom GS1-seeded taxonomy gets us to feature-parity at a fraction of the complexity and without the OWL→JSON preprocessing pipeline. Revisit FoodOn when we need the substitution engine's semantic-distance signals.

### 1.4 Rejected (with reasons)

| Candidate | Reason |
|---|---|
| **FoodKG** | Stale (last commit 2024-11), multi-GB Blazegraph store, remote SPARQL on academic hosting. Not infrastructure; its substitution research is worth mining as design inspiration only. |
| **Nutritionix API** | No usable free tier since misuse crackdown. Starter ~$299/mo. |
| **Edamam Food Database** | TOS explicitly forbids automated programmatic requests — fundamentally incompatible with our use case. |
| **Wikidata food subset** | Broad but inconsistent for groceries; branded coverage is weak; 60-second SPARQL cap inhibits live use. Useful for enrichment of raw ingredients only. |
| **AGROVOC (FAO)** | Agricultural thesaurus, wrong abstraction for consumer grocery. |
| **FAOSTAT** | Statistics-oriented, commodity-level only. |

---

## 2. Candidate Evaluation

### 2.1 FoodOn

- **License:** CC-BY-4.0, free.
- **Coverage:** ~24k food product classes + ~10k linked terms. Strong on raw ingredients via NCBI taxon + FoodOn product classes. **Explicitly not branded** — "cheddar cheese" yes, "Tillamook cheddar" no.
- **UoM:** Not a UoM ontology; defers to UO. Limited portion/package modeling. Gap for us.
- **Access:** Download `foodon.owl` from GitHub; OLS4 REST; Ontobee SPARQL. No npm.
- **Size:** ~40 MB OWL — too large to bundle in a Worker (1 MB free / 10 MB paid compressed). Must preprocess into a trimmed JSON/SQLite artifact in R2/KV.
- **Substitution fit:** Modest — `has food substance analog` + `has defining ingredient` + is_a. MDPI 2022 substitution design pattern maps onto it.
- **Maturity:** Very active (release 2025-07-31, repo pushed 2026-04-17, 216★ on GitHub).
- **Adopters:** Research-heavy (ENVO, CDNO, FOBI, FDA/USDA traceability, RPI/IBM HEALS). No consumer grocery apps found.

### 2.2 FoodKG

- **License:** Apache-2.0 code; inherits Recipe1M license for data.
- **Coverage:** 67M triples — USDA + Recipe1M + FoodOn subset. Weak on branded grocery SKUs.
- **UoM:** USDA-derived portion data; no conversion engine.
- **Access:** RPI-hosted Blazegraph SPARQL; self-host via build scripts. No REST, no dump.
- **Size:** Multi-GB Blazegraph store. **Not edge-runnable.**
- **Substitution fit:** Strongest of the big four — Shirai et al. 2020 built a substitution engine on it using flavor + nutrition embeddings.
- **Maturity:** Stale. Last commit 2024-11-20.
- **Verdict:** Rejected as infrastructure; useful as design inspiration for substitution v2+.

### 2.3 USDA FoodData Central

- **License:** CC0 public domain. Free API key from api.data.gov. **Rate limit: 1000 req/hr per IP** (hard block on exceed).
- **Coverage:** US-focused. **Branded Foods: ~1.8M+ SKUs with UPCs**, monthly GDSN updates. Foundation/SR Legacy/FNDDS cover raw + generic.
- **UoM + package sizes:** Branded records carry `serving_size`, `serving_size_unit`, `package_weight`, `household_serving_fulltext`, GTIN/UPC, brand owner. Best UoM data in the candidate set.
- **Access:** REST (`api.nal.usda.gov/fdc/v1`) + bulk dataset downloads. **Branded Foods dump: ~195 MB zipped JSON / 3.1 GB unzipped.** Latency to CF edge: ~200–500 ms from US-East origin.
- **Ontological structure:** Mostly flat. `branded_food_category` has ~200 buckets; `food_category` on non-branded has ~27 top-level buckets. No deep is-a.
- **Substitution hints:** Strong nutrient vectors (per-100g, ~150 micronutrients) for nutrition-similarity scoring. No dietary flags.
- **Sub-datasets relevant to us:**
  - **Branded Foods** — authoritative US SKU catalog.
  - **SR Legacy** — 7.8k historic reference foods. Frozen 2018 but still the best "generic food" backbone for things like "cooked chicken breast."
  - **Foundation Foods** — 200 commodities with analytical nutrients; biannual.
  - **FNDDS / Experimental** — skip for MVP.
- **Caveat:** Label Insight feed ended Nov 2023, so older Kroger/Walmart private-label SKU data in Branded Foods may be stale. GDSN continues.
- **Role in recommendation:** **Layer B — branded + UoM ground truth.**

### 2.4 Open Food Facts

- **License:** ODbL (database) / ODC-DbCL (facts) / CC-BY-SA (images). Attribution + share-alike required.
- **Coverage:** ~2.8M products, 150+ countries. US coverage thinner than EU (Yuka/OFF community is France-heavy).
- **UoM + package sizes:** `quantity` (free-text like "12 oz" — requires parsing), `serving_size`, `product_quantity` (g), nutriments per-100g AND per-serving.
- **Access:** REST v2 (`/api/v2/search`, `/api/v2/product/{barcode}`) + legacy `/cgi/search.pl`. **Rate limits: 100 req/min product, 10 req/min search, 2 req/min facet.**
- **Size:** JSONL dump ~7 GB compressed / ~43 GB decompressed. Parquet on HuggingFace is lighter (DuckDB-queryable).
- **Ontological structure:** **This is OFF's superpower.** Deep hierarchical taxonomies for `categories_tags`, `ingredients_tags`, `labels_tags`, `allergens_tags`, `brands_tags`, `packaging_tags` — all canonical IDs with synonym maps, multi-lingual. Tag example: `en:orange-juices → en:fruit-juices → en:beverages`.
- **Substitution hints:** Excellent — Nutri-Score, NOVA (ultra-processing), Eco-Score, diet labels (en:vegan, en:gluten-free, en:kosher), allergen sets, category is-a tree.
- **Repo integration:** Already wired as a barcode-lookup nutrition enrichment adapter at `eggs-api/src/integrations/openfoodfacts.ts`. Free-text search capability is unused today.
- **Practical notes:** `countries_tags_en=united-states` pre-filter cuts result size 5–10× and is recommended. 10 req/min search ceiling makes it unviable for live per-keystroke search; fine for batch enrichment and cache warming.
- **Role in recommendation:** **Layer C — dietary/allergen/category enrichment + deep taxonomy synonym lookup.**

### 2.5 Lighter Alternatives

| Option | License/Cost | Branded | Raw | UoM | Access | MVP viability |
|---|---|---|---|---|---|---|
| **Hand-curated TS taxonomy + GS1 GPC seed** | $0 | Author-controlled | Author-controlled | Explicit in schema | Bundled JSON | **High** |
| **LLM-only (no ontology, Claude does it all)** | Claude tokens | Transitive via retailer catalogs | Same | Resolved per query | Prompt + tool_use | High for MVP, risky for consistency |
| **Retailer catalogs as de-facto ontology (Kroger/Walmart)** | Free (already integrated) | Strong (their catalog) | Limited | Per-SKU | REST | **High** — already shipping |
| **Schema.org/Product/Food** | Free vocabulary | N/A (schema, not data) | N/A | QuantitativeValue supported | Pure vocabulary | **High as wire format**, not data source |
| **Wikidata food subset** | CC0 free SPARQL | Weak | Strong | Inconsistent | SPARQL 60s cap | Medium — enrichment only |
| **Nutritionix API** | $299+/mo | 1M+ branded | Good | Yes | REST | Rejected (cost) |
| **Edamam Food Database** | Free tier restricted; $799/mo | 900k | Good | Yes | REST (TOS forbids bulk) | Rejected (TOS) |
| **AGROVOC / FAOSTAT** | Free | None | Varies | No | SPARQL/REST | Rejected (wrong domain) |

The top three (hand-curated TS + GS1 GPC seed, LLM-only, retailer catalogs) are what the recommendation composes. Schema.org is the wire-format choice, not a data source.

---

## 3. Disambiguation Interaction Patterns

### 3.1 How real grocery/recipe apps do it

- **AnyList** — Type-ahead against a curated common-items dictionary + auto-aisle. Disambiguation is user-driven via free-text notes, not app-driven.
- **Paprika** — Deterministic NL ingredient parser, auto-aisle, smart consolidation. No interactive loop; a solved-once parse.
- **Samsung Food (ex-Whisk)** — Proprietary "Food Genome" pipeline driving shoppable output to 29 retailer integrations. Capabilities documented; schema is not.
- **Mealime / Jow** — Scale-by-household + auto-cart generation. No public schema.
- **Instacart Developer Platform** — Public `LineItem` spec: `name` required, `display_text` optional, `upc` (prioritized when present), `line_item_measurements[]` (alternative measurements the matcher picks from). **This is the closest thing to a published "shoppable specification" schema and we should mirror its shape.**

### 3.2 LLM loop patterns (primary sources)

- **Forced tool use for termination.** Claude `tool_choice: { type: "tool", name: ... }` guarantees structured output. We already use this (commit `6244da5`). Extend to two tools: `ask_clarification` (returns 2–4 options + free-text escape) and `finalize_item` (returns the LineItem-shaped spec). Termination = the moment `finalize_item` is called.
- **Strict tool use / constrained decoding.** Anthropic's strict mode compiles JSON schema into a grammar; eliminates the "re-prompt on parse failure" layer.
- **Max-depth defense in depth.** Hard turn cap (3 is plenty for grocery; 15–25 is typical for open-ended agents), wall-clock timeout, and an early-stopping final call without tools to synthesize best-guess `finalize_item` when the cap is hit.
- **Retrieval-grounded option generation.** ProductAgent (arXiv 2407.00942) validates this: retrieve candidate products from the partial parse first, then generate clarification options from the distinguishing attributes of the top candidates. Measured to outperform free-form clarification.

### 3.3 Patterns we should adopt

1. **Mirror Instacart's `LineItem` schema** as our internal "shoppable specification" shape. Wire-compatible with a real third party; battle-tested fields.
2. **Two-tool clarification loop** (`ask_clarification` + `finalize_item`), Claude strict tool use, max 3 turns, early-stopping finalize.
3. **Retrieval-grounded options** — pre-search Kroger/Walmart/USDA on the partial parse; synthesize the 2–4 clarification options from the distinguishing attributes of top candidates. Also aligns with the existing Kroger strip-and-retry fallback scanning pattern.
4. **Three-layer cache** with versioned keys: `{model_id}:{prompt_template_hash}:{ontology_version}:{raw_string_hash}` → `{...}:{normalized_string_hash}` → embedding-similarity fallback (cosine ≥ 0.92). TTL tiered by volatility. Per-user override layer ("I always mean whole milk") outside the cache hierarchy as a user-preference transform.
5. **Aisle taxonomy seeded from GS1 GPC Bricks.** Free, public, standards-aligned.

---

## 4. Proposed Shoppable Item Specification Schema (draft for DESIGN.md)

Mirrors Instacart's LineItem with our additions. Exact shape to be locked in DESIGN.md.

```ts
interface ShoppableItemSpec {
  // Identity
  id: string                           // stable id, survives clarifications
  sourceText: string                   // raw user input, never mutated
  displayName: string                  // resolved human label, e.g. "whole milk"

  // Ontology grounding
  categoryPath: string[]               // ["beverages", "milk", "whole-milk"] from GS1 GPC seed
  usdaFdcId?: number                   // if USDA-grounded
  offCategoryTag?: string              // if OFF-grounded, e.g. "en:whole-milks"
  upc?: string                         // when user specified a brand with known UPC

  // Brand
  brand: string | null                 // null = price-shop mode
  brandLocked: boolean                 // true only if user typed a brand

  // Quantity + UoM
  quantity: number
  unit: CanonicalUnit                  // enum: g, kg, ml, l, oz, fl_oz, lb, each, dozen, ...
  attributes?: Record<string, string>  // fat_content: "whole", preparation: "sliced", etc.

  // Resolution audit
  resolutionTrace: Array<{
    question: string
    options: string[]
    answer: string
    turnNumber: number
  }>
  confidence: 'high' | 'medium' | 'low'   // low when forced finalize hit the turn cap
}
```

Corresponding Instacart-shaped wire representation (for future Instacart fulfillment integration):

```ts
interface InstacartLineItem {
  name: string                         // displayName
  display_text?: string                // sourceText
  upc?: string
  line_item_measurements: Array<{ quantity: number; unit: string }>
}
```

---

## 5. Proposed Caching Strategy (draft for DESIGN.md)

Four scopes, each independently invalidatable:

| Scope | Key | TTL | Storage | Purpose |
|---|---|---|---|---|
| **L1 raw** | `spec:v1:{model}:{ontology_ver}:sha256(lower(trim(raw)))` | 30 days | Cloudflare KV | "I literally typed this exact string before" |
| **L2 normalized** | `spec:v1:{model}:{ontology_ver}:sha256(stripUnitNoise(raw))` | 30 days | Cloudflare KV | "This matches a prior resolution after light normalization" |
| **L3 semantic** | embedding of normalized string → nearest neighbor ≥ 0.92 cos | 30 days | Vectorize | "Someone asked for something very close to this" |
| **User override** | `user_spec:{user_id}:{normalized}` | persistent | Supabase | User preference transforms (e.g. "milk always = whole milk") |

Version any of `{model, ontology_ver, prompt_template_hash}` and every prior entry auto-invalidates — no explicit flush required.

---

## 6. Substitution Engine Hook (future, not Phase 3)

Per the brief's §2.6: do not build in Phase 3. Design notes:

- **Hook point:** right after best-value selection, as an optional "better alternative" pass on a per-item basis.
- **Signal sources under the recommended stack:**
  - **OFF**: dietary labels (en:vegan, en:gluten-free) + NOVA + category siblings.
  - **USDA FDC**: nutrient vectors (per-100g, ~150 micronutrients) → cosine similarity.
  - **GS1 GPC category tree**: is-a walk for generic fallback ("no 2% milk in stock? walk up to milk, suggest whole milk from same store").
  - **FoodKG research (Shirai 2020)**: design reference only — do not adopt the data.
- **Confirmed viable:** all three recommended layers contain enough signal to seed a substitution engine without pulling in FoodKG or FoodOn later. Upgrading to FoodOn becomes purely additive if semantic depth ever exceeds what OFF tags provide.

---

## 7. Open Questions for DESIGN.md (need Jonathan's steer)

Edge cases the brief doesn't resolve that the design doc must:

1. **GS1 GPC seed curation** — do we hand-curate from scratch, or do we let Phase 3 seed it with Claude generating an initial draft from the GS1 public browser, then review? (I lean: Claude draft + manual review, ~1 hour.)
2. **USDA FDC Branded Foods staleness.** The Label Insight feed ended Nov 2023. Some Kroger/Walmart private-label SKUs in Branded Foods may be outdated. Mitigation: trust Kroger/Walmart adapter responses over FDC when both exist; use FDC only as ground truth for UoM + nutrient data, not for price or availability. Agree?
3. **Retrieval-grounded clarification cost.** Pre-searching Kroger/Walmart on partial parses burns quota. Proposal: skip pre-search when L1 or L2 cache hits; only pre-search when the LLM's initial parse has `confidence: low` OR the spec is missing `unit`. Does this match your risk tolerance?
4. **Brand-locked item and avoid-list conflict.** Brief §2.3 rule 3 says respect the user's explicit choice and log a warning. Where does the warning surface — inline on the results row, as a toast on plan generation, or only in the resolution trace?
5. **Unconvertible units.** Brief §2.4 asks for defined behavior when a store returns "each" for an item the user specified in ounces. Proposal: if the item is known-countable (eggs, bananas, apples), convert via GPC-seeded `typical_each_weight_g`. Otherwise, exclude the result from best-value selection with a flag in the per-store card that says "unit mismatch — not comparable." Accept?
6. **OFF category-tag versioning.** OFF tags evolve (the community can rename). When our cache carries `offCategoryTag` and the underlying tag is renamed, we'd stale out. Proposal: version the ontology key (`ontology_ver` in cache key) on any OFF/GPC/FDC schema bump we care about, and re-resolve on mismatch. Implementation detail — raising so it's not a surprise.
7. **Confidence downgrades on AI-sourced stores.** The AI adapter currently passes the input spec's `unit` through unchanged. §4 of DISCOVERY.md flagged that I need to extend `record_shopping_plan` with a `pricedSize: { quantity, unit }` field (which you approved). For stores where the AI can't identify `pricedSize`, what's the fallback — exclude from best-value comparison, or include with `confidence: 'estimated'` and a visual marker? I lean: include with marker, user can see it competing but knows to verify.
8. **Price-per-unit tie-breaking.** When two stores tie exactly on price-per-canonical-unit (rounding), what wins — nearest store, lowest tax, alphabetical? Proposal: nearest store by distance, then alphabetical. Accept?

---

## 8. Source Citations

### Ontology / KG sources
- [FoodOn homepage](https://foodon.org/) — project site
- [FoodOn GitHub](https://github.com/FoodOntology/foodon) — release 2025-07-31, CC-BY-4.0
- [FoodOn OBO Foundry entry](http://obofoundry.org/ontology/foodon.html)
- [FoodOn structure — branded scope](https://foodon.org/design/foodon-structure/)
- [FoodKG homepage](https://foodkg.github.io/) — last commit 2024-11-20
- [FoodKG ISWC 2019 paper](http://www.cs.rpi.edu/~zaki/PaperDir/ISWC19.pdf)
- [Identifying Ingredient Substitutions with FoodKG (Frontiers 2020)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2020.621766/full)
- [USDA FDC API Guide](https://fdc.nal.usda.gov/api-guide/) — 1000 req/hr free
- [USDA FDC Download Datasets](https://fdc.nal.usda.gov/download-datasets/) — 195 MB zipped JSON / 3.1 GB unzipped
- [USDA FDC Data Documentation](https://fdc.nal.usda.gov/data-documentation/)
- [USDA GBFPD Documentation](https://fdc.nal.usda.gov/GBFPD_Documentation/) — Branded Foods schema
- [Open Food Facts API v2 Tutorial](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api/)
- [Open Food Facts API Introduction (rate limits)](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [OFF product-database on HuggingFace (Parquet)](https://huggingface.co/datasets/openfoodfacts/product-database)
- [US Open Food Facts data portal](https://us.openfoodfacts.org/data)
- [GS1 GPC Browser](https://gpc-browser.gs1.org/)
- [GS1 GPC — how it works](https://www.gs1.org/standards/gpc/how-gpc-works)
- [Wikidata SPARQL endpoint](https://query.wikidata.org/)
- [AGROVOC machine-use docs](https://www.fao.org/agrovoc/machine-use)
- [Schema.org Product](https://schema.org/Product)

### Disambiguation / LLM / caching patterns
- [Instacart Developer Platform API](https://docs.instacart.com/developer_platform_api/) — LineItem schema
- [Instacart — Create Shopping List Page](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/)
- [Paprika features](https://www.paprikaapp.com/)
- [AnyList help docs](https://help.anylist.com/articles/getting-started/)
- [Samsung Food "Food Genome" (VentureBeat)](https://venturebeat.com/ai/how-whisk-is-using-its-food-genome-to-turn-recipes-into-smart-shopping-lists/)
- [Claude tool use docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use)
- [Claude tool_choice cookbook](https://github.com/anthropics/anthropic-cookbook/blob/main/tool_use/tool_choice.ipynb)
- [ProductAgent (arXiv 2407.00942)](https://arxiv.org/abs/2407.00942) — retrieval-grounded clarification
- [Redis — semantic caching for LLMs](https://redis.io/blog/what-is-semantic-caching/)
- [Preto.ai — semantic caching patterns](https://preto.ai/blog/semantic-caching-llm/)
- [Steve Kinney — Anatomy of an Agent Loop](https://stevekinney.com/writing/agent-loops)
