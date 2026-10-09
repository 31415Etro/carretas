'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { filterSearchableOptions, type SearchableOption } from '@/lib/searchable-options'
import { cn, sortChoiceOptions } from '@/lib/utils'

type SearchableSelectProps = {
  value?: string
  onValueChange: (value: string) => void
  options: readonly SearchableOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
  id?: string
  onSearchChange?: (query: string) => void
  loading?: boolean
  actionLabel?: string
  onAction?: () => void
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Selecione uma opção',
  searchPlaceholder = 'Pesquisar...',
  emptyLabel = 'Nenhuma opção encontrada.',
  disabled = false,
  triggerClassName,
  contentClassName,
  id,
  onSearchChange,
  loading = false,
  actionLabel,
  onAction,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const safeOptions = React.useMemo(
    () => sortChoiceOptions(options.filter((option, index, list) => Boolean(option.value) && list.findIndex((item) => item.value === option.value) === index)),
    [options],
  )
  const filteredOptions = React.useMemo(() => filterSearchableOptions(safeOptions, query), [query, safeOptions])
  const selectedOption = safeOptions.find((option) => option.value === value)

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
      onSearchChange?.('')
    }
  }

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery)
    onSearchChange?.(nextQuery)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between bg-background font-normal', triggerClassName)}
        >
          <span className="truncate">{selectedOption?.label || placeholder}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}>
        <Command shouldFilter={false}>
          <CommandInput autoFocus placeholder={searchPlaceholder} value={query} onValueChange={changeQuery} />
          <CommandList>
            <CommandEmpty>{loading ? 'Consultando...' : emptyLabel}</CommandEmpty>
            <CommandGroup>
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value)
                    changeOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                  <span>{option.label || option.value}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {actionLabel && onAction ? (
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  changeOpen(false)
                  onAction()
                }}
              >
                <Plus className="size-4" />
                {actionLabel}
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
