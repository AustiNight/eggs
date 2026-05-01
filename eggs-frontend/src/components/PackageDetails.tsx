import React from 'react'
import type { StoreItem } from '../types'
import { packagesNeeded, formatPricePerBase, comparisonNote, unitLabel } from '../lib/displayUnits'

interface Props {
  ingredient: { quantity: number; unit: string }
  item: StoreItem
}

const PackageDetails: React.FC<Props> = ({ ingredient, item }) => {
  const pricedSize = item.pricedSize ?? null
  const count = packagesNeeded(ingredient, pricedSize)
  const unitWord = count === 1 ? 'unit' : 'units'

  let perBaseText: string | null = null
  if (pricedSize) {
    perBaseText = formatPricePerBase(
      computePerBase(item.unitPrice, pricedSize),
      pricedSize.unit
    )
  }

  const note = comparisonNote(ingredient, pricedSize, count)

  if (!pricedSize) {
    return (
      <div className="text-xs text-slate-500">
        {count} {unitWord} · ${item.unitPrice.toFixed(2)} ea
      </div>
    )
  }

  return (
    <div className="text-xs text-slate-500 leading-relaxed">
      <div>
        {count} {unitWord} · {unitLabel(pricedSize.quantity, pricedSize.unit)}
        {perBaseText && <> · {perBaseText}</>}
      </div>
      {note && <div className="text-slate-600 mt-0.5">{note}</div>}
    </div>
  )
}

// Compute price per base unit. Lifts the unit-alias logic locally so
// `displayUnits` stays free of UI concerns. Returns price-per-(g | mL | each).
function computePerBase(unitPrice: number, pricedSize: { quantity: number; unit: string }): number {
  const u = pricedSize.unit.trim().toLowerCase()
  // count-y units: pricePerBase is unitPrice / quantity (e.g. $5.49 / 6 each = $0.92/each)
  if (['unit', 'units', 'each', 'ea', 'ct', 'count', 'dozen', 'dozens', 'piece', 'pieces'].includes(u)) {
    const ea = u === 'dozen' || u === 'dozens' ? pricedSize.quantity * 12 : pricedSize.quantity
    return ea > 0 ? unitPrice / ea : 0
  }
  // mass: convert to grams
  const massFactors: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592 }
  if (u in massFactors) {
    const grams = pricedSize.quantity * massFactors[u]!
    return grams > 0 ? unitPrice / grams : 0
  }
  // volume: convert to mL
  const volFactors: Record<string, number> = { ml: 1, milliliter: 1, milliliters: 1, l: 1000, liter: 1000, liters: 1000, 'fl oz': 29.5735, 'fluid ounce': 29.5735, cup: 236.588, cups: 236.588, pt: 473.176, pint: 473.176, pints: 473.176, qt: 946.353, quart: 946.353, quarts: 946.353, gal: 3785.41, gallon: 3785.41, gallons: 3785.41 }
  if (u in volFactors) {
    const ml = pricedSize.quantity * volFactors[u]!
    return ml > 0 ? unitPrice / ml : 0
  }
  return 0  // unknown — formatPricePerBase will fall back
}

export default PackageDetails
