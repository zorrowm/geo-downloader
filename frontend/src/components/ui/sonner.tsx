import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      // 顶部为 h-12 (48px) 标题栏预留安全区，避免提示遮挡窗口控制按钮
      offset={{ top: 64, right: 16 }}
      toastOptions={{
        classNames: {
          toast: 'group bg-background text-foreground border-border shadow-sm',
        },
      }}
      {...props}
    />
  )
}
