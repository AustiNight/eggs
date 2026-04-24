import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ClarificationModal from './ClarificationModal'

describe('ClarificationModal', () => {
  it('emits structured answer with baseName + selectedOptions (not a flattened string)', () => {
    const onComplete = vi.fn()
    render(
      <ClarificationModal
        requests={[{
          itemId: 'i1',
          originalName: 'chicken thighs',
          question: 'Which style?',
          options: ['Boneless', 'Skinless', 'Bone-in'],
        }]}
        onComplete={onComplete}
      />
    )

    fireEvent.click(screen.getByText('Boneless'))
    fireEvent.click(screen.getByText('Skinless'))
    fireEvent.click(screen.getByRole('button', { name: /Find Deals/i }))

    expect(onComplete).toHaveBeenCalledWith({
      i1: { baseName: 'chicken thighs', selectedOptions: ['Boneless', 'Skinless'] },
    })
  })

  it('handles multiple selections correctly', () => {
    const onComplete = vi.fn()
    render(
      <ClarificationModal
        requests={[
          { itemId: 'i1', originalName: 'A', question: '?', options: ['x', 'y'] },
          { itemId: 'i2', originalName: 'B', question: '?', options: ['p', 'q'] },
        ]}
        onComplete={onComplete}
      />
    )
    fireEvent.click(screen.getByText('x'))
    fireEvent.click(screen.getByText('p'))
    fireEvent.click(screen.getByRole('button', { name: /Find Deals/i }))
    expect(onComplete).toHaveBeenCalledWith({
      i1: { baseName: 'A', selectedOptions: ['x'] },
      i2: { baseName: 'B', selectedOptions: ['p'] },
    })
  })
})
