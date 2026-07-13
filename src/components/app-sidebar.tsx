import * as React from "react"
import {
  ChevronRightIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
} from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
            render={<button type="button" />}
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
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="nazboard">
              <HardDriveIcon />
              <span className="font-heading text-sm">nazboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Overview"
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
                <Collapsible key={pool.name} defaultOpen>
                  <SidebarMenuItem>
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          tooltip={pool.name}
                          isActive={
                            selection.kind === "pool" &&
                            selection.id === pool.name
                          }
                          onClick={() =>
                            onNavigate({ kind: "pool", id: pool.name })
                          }
                        />
                      }
                    >
                      <HardDriveIcon />
                      <span>{pool.name}</span>
                      <ChevronRightIcon className="ml-auto transition-transform group-data-[panel-open]/collapsible:rotate-90" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <DatasetTree
                        datasets={pool.datasets}
                        selection={selection}
                        onNavigate={onNavigate}
                      />
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
