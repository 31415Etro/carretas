"use client"

import { cn } from "@/lib/utils"
import Link, { type LinkProps } from "next/link"
import type React from "react"
import { useState, createContext, useContext } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Menu, X } from "lucide-react"

interface Links {
  label: string
  href: string
  icon: React.JSX.Element | React.ReactNode
}

interface SidebarContextProps {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  animate: boolean
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined)

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode
  open?: boolean
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>
  animate?: boolean
}) => {
  const [openState, setOpenState] = useState(false)

  const open = openProp !== undefined ? openProp : openState
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState

  return <SidebarContext.Provider value={{ open, setOpen, animate }}>{children}</SidebarContext.Provider>
}

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode
  open?: boolean
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>
  animate?: boolean
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  )
}

export const SidebarBody = (props: React.ComponentProps<typeof motion.div>) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar {...(props as React.ComponentProps<"div">)} />
    </>
  )
}

export const DesktopSidebar = ({ className, children, ...props }: React.ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar()
  return (
    <motion.div
      className={cn(
        "h-full py-6 hidden md:flex md:flex-col bg-sidebar border-r border-border flex-shrink-0",
        "shadow-sm transition-shadow duration-300",
        className,
      )}
      animate={{
        width: animate ? (open ? "280px" : "80px") : "280px",
        paddingLeft: animate ? (open ? "16px" : "12px") : "16px",
        paddingRight: animate ? (open ? "16px" : "12px") : "16px",
      }}
      transition={{
        duration: 0.3,
        ease: "easeInOut",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...props}
    >
      {children}
    </motion.div>
  )
}

export const MobileSidebar = ({ className, children, ...props }: React.ComponentProps<"div">) => {
  const { open, setOpen } = useSidebar()
  return (
    <>
      <div
        className={cn(
          "h-16 px-6 flex flex-row md:hidden items-center justify-between bg-sidebar border-b border-border w-full shadow-sm",
        )}
        {...props}
      >
        <div className="flex justify-end z-20 w-full">
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-lg hover:bg-muted transition-colors duration-200"
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5 text-foreground" />
          </button>
        </div>
        <AnimatePresence>
          {open && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 z-[90] backdrop-blur-sm"
                onClick={() => setOpen(false)}
              />
              {/* Sidebar */}
              <motion.div
                initial={{ x: "-100%", opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "-100%", opacity: 0 }}
                transition={{
                  duration: 0.3,
                  ease: "easeInOut",
                }}
                className={cn(
                  "fixed h-full w-[280px] inset-y-0 left-0 bg-sidebar border-r border-border p-6 z-[100] flex flex-col shadow-2xl",
                  className,
                )}
              >
                <button
                  onClick={() => setOpen(false)}
                  className="absolute right-4 top-4 p-2 rounded-lg hover:bg-muted transition-colors duration-200"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5 text-foreground" />
                </button>
                <div className="mt-12">{children}</div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

export const SidebarLink = ({
  link,
  className,
  ...props
}: {
  link: Links
  className?: string
  props?: LinkProps
}) => {
  const { open, animate } = useSidebar()
  return (
    <Link
      href={link.href}
      prefetch={false}
      className={cn(
        "flex items-center gap-3 group/sidebar py-2 px-3 rounded-lg",
        "hover:bg-muted/80 active:bg-muted transition-all duration-200",
        "relative overflow-hidden",
        open ? "justify-start" : "justify-center",
        className,
      )}
      {...props}
    >
      {/* Icon container with consistent sizing */}
      <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 text-muted-foreground group-hover/sidebar:text-primary transition-colors duration-200">
        {link.icon}
      </div>

      {/* Label with smooth animation */}
      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
          width: animate ? (open ? "auto" : 0) : "auto",
        }}
        transition={{
          duration: 0.2,
          ease: "easeInOut",
        }}
        className="text-foreground text-sm font-medium whitespace-nowrap overflow-hidden"
      >
        {link.label}
      </motion.span>

      {/* Hover indicator */}
      <motion.div
        className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-r-full"
        initial={{ opacity: 0, scaleY: 0 }}
        whileHover={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.2 }}
      />
    </Link>
  )
}
