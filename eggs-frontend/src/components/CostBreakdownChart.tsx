import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

export interface StoreTotal {
  name: string
  value: number
}

interface Props {
  data: StoreTotal[]
  height?: number
}

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6']

export const CostBreakdownChart: React.FC<Props> = ({ data, height = 256 }) => {
  if (data.length === 0) return null
  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <h3 className="text-sm font-medium text-slate-300 mb-3">Cost by store</h3>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
              {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default CostBreakdownChart
