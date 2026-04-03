  // ── Narrative summary ────────────────────────────────────────────────────
  // Generates the human-readable "why we chose these stores" paragraph
  // shown in the results screen. Runs after plan is assembled, uses actual
  // store/item data so the summary is grounded in the real results.

  let planNarrative = ''
  try {
    const storeLines = finalStores.map(s => {
      const itemCount = s.items.length
      const source = s.priceSource === 'kroger_api' ? 'live Kroger API pricing' : 'AI-estimated pricing'
      return `${s.storeName} (${itemCount} items, ${source}, subtotal $${s.subtotal.toFixed(2)})`
    }).join('; ')

    const realCount = finalStores.flatMap(s => s.items).filter(i => i.confidence === 'real').length
    const totalItems = finalStores.flatMap(s => s.items).length
    const budgetNote = body.budget?.mode === 'ceiling' && body.budget.amount
      ? ` Budget ceiling was $${body.budget.amount.toFixed(2)} — plan ${total > body.budget.amount ? 'exceeded' : 'came in under'} at $${total.toFixed(2)}.`
      : ''

    const narrativePrompt = `You are the E.G.G.S. shopping agent. Write a 2-3 sentence summary explaining the shopping plan results below. Be specific about which stores were chosen and why. Mention if Kroger API provided real prices vs AI estimates. Be direct and helpful, not salesy.

Plan results:
- Stores: ${storeLines}
- Total: $${total.toFixed(2)} (including ~8.25% tax)
- ${realCount} of ${totalItems} item prices came from live Kroger API; the rest are AI estimates${budgetNote}
- Search radius: ${body.settings.radiusMiles} miles, max ${body.settings.maxStores} stores

Write only the summary paragraph, no preamble.`

    const narrativeResult = await provider.complete({
      system: 'You write concise, honest shopping plan summaries for a grocery price optimization tool.',
      messages: [{ role: 'user', content: narrativePrompt }],
      maxTokens: 200,
      jsonMode: false
    })

    planNarrative = narrativeResult.content.trim()
  } catch {
    // Narrative is non-critical — fall back to a generated string
    planNarrative = `Found lowest prices across ${finalStores.length} store${finalStores.length !== 1 ? 's' : ''} within ${body.settings.radiusMiles} miles. Prioritized lowest total cost with loyalty card pricing applied at every chain.`
  }
