import { cn } from '@/lib/utils'
import type { ComponentType, ReactNode, SVGProps } from 'react'

interface PanelSectionProps {
  title?: ReactNode
  description?: ReactNode
  icon?: ComponentType<SVGProps<SVGSVGElement>>
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/** 统一的右侧面板分组容器：白色卡片 + 顶部小标题 + 内容。 */
export function PanelSection({
  title,
  description,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: PanelSectionProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-[var(--shadow-soft)]',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && (
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-3.5" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h3 className="truncate text-xs font-semibold">{title}</h3>}
              {description && (
                <p className="truncate text-[11px] text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('space-y-3 p-3', bodyClassName)}>{children}</div>
    </section>
  )
}
