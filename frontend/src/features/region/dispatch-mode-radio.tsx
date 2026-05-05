import type { DownloadDispatchMode } from './use-multi-feature-submit'

interface Props {
  count: number
  mode: DownloadDispatchMode
  onChange: (m: DownloadDispatchMode) => void
}

export function DispatchModeRadio({ count, mode, onChange }: Props) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        多要素下载方式（已导入 {count} 个要素）
      </label>
      <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2 text-xs">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'merge'}
            onChange={() => onChange('merge')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">合并下载</span>
            <span className="ml-1 text-muted-foreground">
              按所有要素的总范围下载一个任务、输出一个文件
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            checked={mode === 'split'}
            onChange={() => onChange('split')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">拆分下载</span>
            <span className="ml-1 text-muted-foreground">
              按要素逐个下载，每个要素一个任务一个文件（共 {count} 个）
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}
