'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { SearchableSelect } from '@/components/ui/searchable-select'
import { cn, compareAlphaNumeric } from '@/lib/utils'

function selectItemText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!React.isValidElement(node)) {
    return React.Children.toArray(node).map(selectItemText).filter(Boolean).join(' ')
  }
  return selectItemText((node.props as { children?: React.ReactNode }).children)
}

function flattenSelectChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      return flattenSelectChildren((child.props as { children?: React.ReactNode }).children)
    }
    return [child]
  })
}

function findSelectValue(node: React.ReactNode): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue
    if (child.type === SelectValue) return child
    const nested = findSelectValue((child.props as { children?: React.ReactNode }).children)
    if (nested) return nested
  }
}

function sortedSelectChildren(children: React.ReactNode) {
  const items = flattenSelectChildren(children)
  const sortable = items.filter((item) => React.isValidElement(item) && item.type === SelectItem)
  if (sortable.length !== items.length) return children

  return sortable.sort((left, right) => {
    const leftProps = (left as React.ReactElement<{ value?: string; children?: React.ReactNode }>).props
    const rightProps = (right as React.ReactElement<{ value?: string; children?: React.ReactNode }>).props
    const neutralPattern = /^(all|todos?|todas?|none|nenhum|nenhuma|sem(?:-|\s)|selecione)/i
    const leftNeutral = neutralPattern.test(String(leftProps.value || ''))
    const rightNeutral = neutralPattern.test(String(rightProps.value || ''))
    if (leftNeutral !== rightNeutral) return leftNeutral ? -1 : 1
    return compareAlphaNumeric(selectItemText(leftProps.children), selectItemText(rightProps.children))
  })
}

function Select({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const directChildren = React.Children.toArray(children)
  const trigger = directChildren.find((child) => React.isValidElement(child) && child.type === SelectTrigger)
  const content = directChildren.find((child) => React.isValidElement(child) && child.type === SelectContent)
  const contentProps = React.isValidElement(content)
    ? (content.props as { children?: React.ReactNode; sortItems?: boolean; searchPlaceholder?: string; emptyLabel?: string })
    : undefined

  if (React.isValidElement(trigger) && contentProps?.sortItems) {
    const triggerProps = trigger.props as React.ComponentProps<typeof SelectPrimitive.Trigger>
    const valueElement = findSelectValue(triggerProps.children)
    const valueProps = valueElement?.props as { placeholder?: React.ReactNode } | undefined
    const options = flattenSelectChildren(contentProps.children)
      .filter((item): item is React.ReactElement<React.ComponentProps<typeof SelectPrimitive.Item>> => React.isValidElement(item) && item.type === SelectItem)
      .map((item) => ({
        value: item.props.value,
        label: selectItemText(item.props.children),
        disabled: item.props.disabled,
      }))

    return (
      <SearchableSelect
        id={triggerProps.id}
        value={props.value ?? props.defaultValue}
        onValueChange={props.onValueChange || (() => undefined)}
        options={options}
        placeholder={typeof valueProps?.placeholder === 'string' ? valueProps.placeholder : 'Selecione uma opção'}
        searchPlaceholder={contentProps.searchPlaceholder}
        emptyLabel={contentProps.emptyLabel}
        disabled={props.disabled || triggerProps.disabled}
        triggerClassName={triggerProps.className}
      />
    )
  }

  return <SelectPrimitive.Root data-slot="select" {...props}>{children}</SelectPrimitive.Root>
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sortItems = false,
  searchPlaceholder,
  emptyLabel,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  sortItems?: boolean
  searchPlaceholder?: string
  emptyLabel?: string
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-64 min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' &&
              'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1',
          )}
        >
          {sortItems ? sortedSelectChildren(children) : children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
