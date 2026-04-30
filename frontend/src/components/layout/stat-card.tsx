import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface StatCardProps {
  children: ReactNode
  className?: string
  /** 'default' = 行间距 1；'compact' = 单行/短文本，无 space-y */
  variant?: 'default' | 'compact'
}

/** 统一的"估算 / 汇总 / 结果"信息卡片样式。 */
export function StatCard({ children, className, variant = 'default' }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-border/60 bg-muted/30 p-2 text-xs',
        variant === 'default' && 'space-y-1',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface StatRowProps {
  label: ReactNode
  value: ReactNode
  className?: string
}

/** StatCard 内部的一行：左侧灰色标签，右侧加粗数值。 */
export function StatRow({ label, value, className }: StatRowProps) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="text-muted-foreground">{label}</span>
      <strong className="font-semibold tabular-nums">{value}</strong>
    </div>
  )
}
