import React from 'react'
import { AlertCircle, Info } from 'lucide-react'
import type { AlignmentGrade } from '../types'

interface Props {
  grade: AlignmentGrade
}

const SubstituteBadge: React.FC<Props> = ({ grade }) => {
  if (grade.category === 'exact') return null

  if (grade.category === 'wrong') {
    // Should not appear post-P2.8 (selectWinner drops these), but if a regression
    // sneaks through, scream loudly.
    return (
      <span
        title={grade.reason || 'This product was flagged as the wrong product class.'}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-red-500/20 text-red-300 border border-red-500/40 ml-2"
      >
        <AlertCircle className="w-3 h-3" />
        Wrong product
      </span>
    )
  }

  // category === 'substitute'
  return (
    <span
      title={grade.reason}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-amber-500/15 text-amber-300 border border-amber-500/30 ml-2 cursor-help"
    >
      <Info className="w-3 h-3" />
      Substitute · Why?
    </span>
  )
}

export default SubstituteBadge
