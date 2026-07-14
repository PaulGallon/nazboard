import type { ReactNode } from "react"
import { CircleQuestionMarkIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type PanelHelpProps = {
  source: string
  children: ReactNode
}

export function PanelHelp({ source, children }: PanelHelpProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="About this panel"
          />
        }
      >
        <CircleQuestionMarkIcon />
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="flex max-w-80 flex-col items-start gap-2"
      >
        <span>{children}</span>
        <span className="font-mono opacity-75">Source: {source}</span>
      </TooltipContent>
    </Tooltip>
  )
}
