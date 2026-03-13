import { GoogleGenAI, Type } from "@google/genai";
import { ShoppingItem, GeoLocation, AppSettings, ShoppingPlan, ClarificationRequest, UserProfile } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Robust JSON extractor that handles nested objects/arrays and ignores braces inside strings
const cleanJsonString = (str: string): string => {
  let startIndex = -1;
  let openChar = '';
  let closeChar = '';

  // 1. Find the first valid opening character
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      startIndex = i;
      openChar = '{';
      closeChar = '}';
      break;
    }
    if (str[i] === '[') {
      startIndex = i;
      openChar = '[';
      closeChar = ']';
      break;
    }
  }

  if (startIndex === -1) return "{}";

  // 2. Iterate using a stack to find the matching closing character
  let stack = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (inString) {
      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else if (char === '"' && !isEscaped) {
        inString = false;
      } else {
        isEscaped = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) {
      stack++;
    } else if (char === closeChar) {
      stack--;
      if (stack === 0) {
        // Found the end of the JSON structure
        return str.substring(startIndex, i + 1);
      }
    }
  }

  // If we get here, the JSON might be incomplete, but let's try to return what we have
  // or return the substring if it looks like it ended abruptly.
  // Fallback: simple trimming of markdown
  return str.replace(/```json/g, '').replace(/```/g, '').trim();
};

/**
 * Stage 1: Analyze the list for ambiguities.
 */
export const analyzeShoppingList = async (
  items: ShoppingItem[]
): Promise<ClarificationRequest[] | null> => {
  try {
    // PASS IDs explicitly so the AI knows which item is which
    const itemsContext = items.map(i => `Item ID: "${i.id}" | Description: "${i.quantity} ${i.unit || ''} ${i.name}"`).join('\n');
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `I have a grocery list with specific IDs:
      ${itemsContext}

      Analyze this list for any vague items that need clarification to find the *exact* lowest price at a grocery store.
      
      CRITICAL INSTRUCTIONS:
      1. **USE PROVIDED IDs**: You MUST return the exact "Item ID" provided in the input for the 'itemId' field.
      2. **SPLIT VARIABLES**: If an item is vague in MULTIPLE ways (e.g. "Trash Bags" needs "Gallon Size" AND "Closure Type", or "Honey" needs "Size" AND "Flower Type"), you MUST create SEPARATE clarification objects for EACH variable.
      3. **BE PROACTIVE**: If the item is generic (e.g. "Milk", "Eggs", "Bread", "Butter"), you SHOULD ask for specifics (Fat content, Size, Organic/Conventional, Salted/Unsalted) unless specified.
      4. **OPTIONS**: Provide 2-5 distinct, realistic options for the user.

      Example Response Format:
      [
        { "itemId": "id_from_input", "originalName": "Honey", "question": "What size container?", "options": ["12oz", "24oz", "Bear"] },
        { "itemId": "id_from_input", "originalName": "Honey", "question": "What type of honey?", "options": ["Clover", "Wildflower", "Raw"] }
      ]

      If EVERYTHING is perfectly specific (e.g. "1 gallon whole milk"), return an empty array [].
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              itemId: { type: Type.STRING },
              originalName: { type: Type.STRING },
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    
    const cleanedText = cleanJsonString(text);
    const data = JSON.parse(cleanedText);
    
    // Ensure we actually got an array
    if (Array.isArray(data) && data.length > 0) {
      return data as ClarificationRequest[];
    }
    
    return null;

  } catch (error) {
    console.error("Error analyzing list:", error);
    return null;
  }
};

/**
 * Stage 2: The heavy lifter. Search via Grounding, optimize, and return plan.
 */
export const generateShoppingPlan = async (
  items: ShoppingItem[],
  location: GeoLocation,
  settings: AppSettings,
  userProfile?: UserProfile | null
): Promise<ShoppingPlan> => {
  const itemDescriptions = items.map(i => i.clarifiedName || i.name).join(', ');

  const addressString = userProfile?.address ? `User Home Address: ${userProfile.address}` : `GPS Lat/Lng: ${location.lat}, ${location.lng}`;
  const avoidStores = userProfile?.avoidStores?.length ? `DO NOT SEARCH OR INCLUDE: ${userProfile.avoidStores.join(', ')}` : "No store exclusions.";
  const avoidBrands = userProfile?.avoidBrands?.length ? `DO NOT INCLUDE BRANDS: ${userProfile.avoidBrands.join(', ')}` : "No brand exclusions.";

  const prompt = `
    You are "The Price of E.G.G.S.", an advanced shopping agent.
    
    CONTEXT:
    ${addressString}
    Shopping List: ${itemDescriptions}
    ${avoidStores}
    ${avoidBrands}
    
    SETTINGS:
    - Search Radius: ${settings.radius} miles
    - Max Stores to visit: ${settings.maxStores}
    - Curbside Pickup Distance Limit: ${settings.curbsideDistance} miles
    - Include Delivery: ${settings.includeDelivery}
    
    CORE RULES (UNBREAKABLE):
    1. **LOWEST PRICE IS KING**: Your PRIMARY GOAL is to find the absolute lowest total cost.
    2. **NO ARTIFICIAL CONSOLIDATION**: Do NOT consolidate items to a single retailer just to "save a trip" or "minimize stops" if it results in a higher price. 
       - You are ONLY allowed to consolidate IF AND ONLY IF the number of stores with lowest prices > ${settings.maxStores}. 
       - If the lowest prices are found across 5 stores and Max Stores is 5, KEEP 5 STORES. Do not reduce to 2.
    3. **LOYALTY PRICING**: Assume the user has a loyalty card for every chain. Use the "Member Price" or "Digital Coupon Price" as the effective price.
    4. **TAX**: Calculate an estimated tax (approx 8.25%) for each store subtotal.
    5. **AVOID LISTS**: Strictly respect the avoid stores/brands lists above.
    6. **PROOF OF PRICE**: You MUST provide a specific "proofUrl" for every item. This is the source link where the price was found (e.g. product detail page, weekly ad PDF).

    CRITICAL - PRICE VERIFICATION:
    - The 'price' you list MUST match the price visible on the 'proofUrl'.
    - If you find a generic item, use a Search Result URL for the 'proofUrl' that specifically shows that price (e.g. google.com/search?q=walmart+great+value+milk+price).
    - Do not invent prices. If you cannot find a price, estimate based on national average and set confidence to 'estimated'.

    ALGORITHM:
    1. Scan ALL valid retailers in radius.
    2. Find the lowest price for EACH item individually.
    3. Count the unique stores.
    4. IF Store Count <= ${settings.maxStores}: RETURN THIS PLAN.
    5. IF Store Count > ${settings.maxStores}: Only then, merge the smallest purchases into the primary stores to meet the limit, finding the lowest cost penalty.

    OUTPUT FORMAT (JSON ONLY):
    {
      "id": "plan-id",
      "summary": "Explain your logic clearly. Explicitly state that you prioritized lowest price over convenience. If you did NOT consolidate, say why (e.g. 'Found lowest prices across 3 stores, meeting your limit. No consolidation needed.').",
      "totalCost": number, // Sum of subtotals (pre-tax)
      "totalTax": number, // Sum of taxes
      "finalTotal": number, // Cost + Tax
      "totalSavings": number,
      "analysisMetadata": {
         "totalStoresScanned": number,
         "radiusSearched": number,
         "dealsAnalyzed": number
      },
      "stores": [
        {
          "storeName": "Name",
          "storeAddress": "Address",
          "storeType": "Physical" | "Delivery",
          "distance": "e.g. 2.4 miles",
          "subtotal": number,
          "estimatedTax": number,
          "grandTotal": number,
          "link": "https://www.retailer.com/search?q=...", 
          "items": [
             {
               "name": "Specific Item",
               "quantity": number,
               "price": number, // The effective price (member price)
               "nonMemberPrice": number, // Higher price or same
               "isLoyaltyPrice": boolean, // true if price < nonMemberPrice
               "total": number,
               "confidence": "high" | "estimated",
               "productId": "ID",
               "productUrl": "https://www.retailer.com/search?q=specific+item+query", // A robust search URL to help user add to cart
               "proofUrl": "https://www.retailer.com/ip/actual-product-page", // The exact source where price was verified
               "automationAction": "click(btn-add-to-cart)"
             }
          ]
        }
      ]
    }
  `;

  let attempts = 0;
  while (attempts < 2) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }], 
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");

      const cleanedText = cleanJsonString(text);
      const plan = JSON.parse(cleanedText) as ShoppingPlan;
      
      if (!plan.stores || !Array.isArray(plan.stores)) {
        throw new Error("Invalid plan structure received");
      }

      return plan;

    } catch (error) {
      console.warn(`Attempt ${attempts + 1} failed:`, error);
      attempts++;
      if (attempts >= 2) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  throw new Error("Failed to generate plan after retries.");
};