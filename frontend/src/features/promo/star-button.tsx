import { Star } from 'lucide-react'

import { Button } from '@/components/ui/button'

const REPO_URL = 'https://github.com/gaopengbin/geo-downloader'

export function StarButton() {
  return (
    <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
      <a href={REPO_URL} target="_blank" rel="noreferrer" title="Star on GitHub">
        <Star className="size-3.5" />
        Star
      </a>
    </Button>
  )
}
