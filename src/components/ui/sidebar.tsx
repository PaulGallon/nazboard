import * as React from "react"
import { PanelLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

type SidebarContextValue = {
  isMobile: boolean
  open: boolean
  openMobile: boolean
  setOpenMobile: React.Dispatch<React.SetStateAction<boolean>>
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider")
  }
  return context
}

function SidebarProvider({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(true)
  const [openMobile, setOpenMobile] = React.useState(false)

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((current) => !current)
      return
    }
    setOpen((current) => !current)
  }, [isMobile])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  const value = React.useMemo(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [isMobile, open, openMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full [--sidebar-width-mobile:18rem] [--sidebar-width:16rem]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile, open, openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          className="w-(--sidebar-width-mobile) bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Pool and dataset navigation</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      className="group peer hidden text-sidebar-foreground md:block"
    >
      <div className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[state=collapsed]:w-0" />
      <div
        data-sidebar="sidebar"
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) border-r bg-sidebar transition-[left] duration-200 ease-linear group-data-[state=collapsed]:left-[calc(var(--sidebar-width)*-1)] md:flex",
          className
        )}
        {...props}
      >
        <div className="relative flex size-full flex-col">{children}</div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      aria-expanded={isMobile ? openMobile : open}
      className={className}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle navigation</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      type="button"
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle navigation"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle navigation"
      className={cn(
        "absolute inset-y-0 -right-2 hidden w-4 cursor-w-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-sidebar-border sm:block",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        className
      )}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col overflow-auto",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn(
        "relative flex w-full min-w-0 flex-col px-2 py-1",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs text-sidebar-foreground/70",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-xs", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-px", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

function SidebarMenuButton({
  isActive = false,
  className,
  onClick,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-xs outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        if (isMobile && !event.defaultPrevented) {
          setOpenMobile(false)
        }
      }}
      {...props}
    />
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  isActive = false,
  className,
  onClick,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <button
      type="button"
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-active={isActive || undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-7 w-full min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-left text-xs text-sidebar-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        className
      )}
      onClick={(event) => {
        onClick?.(event)
        if (isMobile && !event.defaultPrevented) {
          setOpenMobile(false)
        }
      }}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
}
