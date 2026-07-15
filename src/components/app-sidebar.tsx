import * as React from "react"
import {
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  SquareTerminalIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { DatasetStatus, Selection, StatusPayload } from "@/lib/status"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  status: StatusPayload | null
  selection: Selection
  onNavigate: (selection: Selection) => void
}

function DatasetTree({
  datasets,
  selection,
  onNavigate,
}: {
  datasets: DatasetStatus[]
  selection: Selection
  onNavigate: (selection: Selection) => void
}) {
  return (
    <SidebarMenuSub>
      {datasets.map((dataset) => (
        <SidebarMenuSubItem key={dataset.path}>
          <SidebarMenuSubButton
            isActive={
              selection.kind === "dataset" && selection.id === dataset.path
            }
            onClick={() => onNavigate({ kind: "dataset", id: dataset.path })}
          >
            <DatabaseIcon />
            <span>{dataset.name}</span>
          </SidebarMenuSubButton>
          {dataset.children.length > 0 && (
            <DatasetTree
              datasets={dataset.children}
              selection={selection}
              onNavigate={onNavigate}
            />
          )}
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  )
}

export function AppSidebar({
  status,
  selection,
  onNavigate,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex h-12 items-center gap-2 px-2 text-sidebar-foreground">
              <HardDriveIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="font-heading text-sm">nazboard</span>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={selection.kind === "overview"}
                  onClick={() => onNavigate({ kind: "overview" })}
                >
                  <GaugeIcon />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Pools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {status?.pools.map((pool) => (
                <SidebarMenuItem key={pool.name}>
                  <SidebarMenuButton
                    isActive={
                      selection.kind === "pool" && selection.id === pool.name
                    }
                    onClick={() => onNavigate({ kind: "pool", id: pool.name })}
                  >
                    <HardDriveIcon />
                    <span>{pool.name}</span>
                  </SidebarMenuButton>
                  <DatasetTree
                    datasets={pool.datasets}
                    selection={selection}
                    onNavigate={onNavigate}
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Raw</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={selection.kind === "raw"}
                  onClick={() => onNavigate({ kind: "raw" })}
                >
                  <SquareTerminalIcon />
                  <span>Command output</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
