import React from 'react'
import type { PlanDiagnostics } from '../types'

interface Props {
  diagnostics: PlanDiagnostics
}

function pluralize(n: number, sing: string, plur: string = sing + 's'): string {
  return n === 1 ? sing : plur
}

const DiagnosticsDisclosure: React.FC<Props> = ({ diagnostics }) => {
  const sr = diagnostics.sizeResolver
  const gr = diagnostics.grader
  const on = diagnostics.ontology
  const ai = diagnostics.ai

  const sizeBySource = Object.entries(sr.bySource).filter(([, n]) => n > 0)
  const sizeText = sr.resolved === 0
    ? `Every package size parsed cleanly — no fallback resolution needed.`
    : `Resolved ${sr.resolved} ${pluralize(sr.resolved, 'unparseable package size', 'unparseable package sizes')} via ${sizeBySource.map(([src, n]) => `${prettySource(src)} (${n})`).join(', ')}.${sr.failed > 0 ? ` ${sr.failed} could not be resolved.` : ''}`

  const graderText = gr.specsGraded === 0
    ? `Candidate grading didn't run for this plan.`
    : `Graded ${gr.totalCandidates} ${pluralize(gr.totalCandidates, 'product')} across ${gr.specsGraded} ${pluralize(gr.specsGraded, 'ingredient')}.${gr.cacheHits > 0 ? ` ${gr.cacheHits} reused from cache.` : ''}${gr.rejectedAsWrong > 0 ? ` ${gr.rejectedAsWrong} rejected as the wrong product class.` : ''}`

  const ontologyText = on.broaderTermsAttempted === 0
    ? `None needed — every search term hit a direct match.`
    : `Tried ${on.broaderTermsAttempted} ${pluralize(on.broaderTermsAttempted, 'broader term')} when the user's exact wording missed; ${on.broaderTermsSucceeded} ${on.broaderTermsSucceeded === 1 ? 'recovered a match' : 'recovered matches'}.`

  const aiText = aiSummary(ai)

  return (
    <details className="mt-4 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3">
      <summary className="cursor-pointer text-sm text-slate-300 select-none">How we picked these matches</summary>
      <dl className="mt-3 space-y-3 text-xs text-slate-400">
        <div>
          <dt className="font-medium text-slate-300">Size resolution</dt>
          <dd className="mt-0.5">{sizeText}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-300">Candidate grading</dt>
          <dd className="mt-0.5">{graderText}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-300">Ontology fallback</dt>
          <dd className="mt-0.5">{ontologyText}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-300">AI store search</dt>
          <dd className="mt-0.5">{aiText}</dd>
        </div>
      </dl>
    </details>
  )
}

function prettySource(s: string): string {
  switch (s) {
    case 'parseSize': return 'direct parse'
    case 'fdc': return 'USDA FDC'
    case 'off': return 'Open Food Facts'
    case 'web_fetch': return 'web fetch'
    case 'web_search': return 'web search'
    default: return s
  }
}

function aiSummary(ai: PlanDiagnostics['ai']): string {
  if (ai.pass1Failed) return `AI store research couldn't run on this plan.`
  if (ai.pass2Failed) return `AI store research returned data but couldn't be formatted; falling back to direct-API stores.`
  if (ai.candidateCount === 0) return `AI search didn't surface any additional candidates.`
  const verifNote = ai.proofUrlsValidated > 0
    ? ` ${ai.proofUrlsContentVerified} proof URLs verified${ai.proofUrlsContentRejected > 0 ? `, ${ai.proofUrlsContentRejected} rejected as mismatches` : ''}.`
    : ''
  return `Returned ${ai.candidateCount} ${ai.candidateCount === 1 ? 'item' : 'items'} from additional stores.${verifNote}`
}

export default DiagnosticsDisclosure
