import * as React from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  getFirstCollision,
  pointerWithin,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  defaultAnimateLayoutChanges,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import type { AnimateLayoutChanges } from '@dnd-kit/sortable'
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DraggableAttributes,
  DraggableSyntheticListeners,
  DropAnimation,
  Modifiers,
  UniqueIdentifier
} from '@dnd-kit/core'
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@renderer/lib/utils'

interface KanbanContextProps<T> {
  columns: Record<string, Array<T>>
  setColumns: (columns: Record<string, Array<T>>) => void
  getItemId: (item: T) => string
  columnIds: Array<string>
  activeId: UniqueIdentifier | null
  setActiveId: (id: UniqueIdentifier | null) => void
  findContainer: (id: UniqueIdentifier) => string | undefined
  isColumn: (id: UniqueIdentifier) => boolean
  modifiers?: Modifiers
}

const KanbanContext = createContext<KanbanContextProps<any>>({
  columns: {},
  setColumns: () => {},
  getItemId: () => '',
  columnIds: [],
  activeId: null,
  setActiveId: () => {},
  findContainer: () => undefined,
  isColumn: () => false,
  modifiers: undefined
})

const ColumnContext = createContext<{
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners | undefined
  isDragging?: boolean
  disabled?: boolean
}>({
  attributes: {} as DraggableAttributes,
  listeners: undefined,
  isDragging: false,
  disabled: false
})

const ItemContext = createContext<{
  listeners: DraggableSyntheticListeners | undefined
  isDragging?: boolean
  disabled?: boolean
}>({
  listeners: undefined,
  isDragging: false,
  disabled: false
})

const IsOverlayContext = createContext(false)

const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

const dropAnimationConfig: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.4'
      }
    }
  })
}

export interface KanbanMoveEvent {
  event: DragEndEvent
  activeContainer: string
  activeIndex: number
  overContainer: string
  overIndex: number
}

export interface KanbanRootProps<T> extends Omit<useRender.ComponentProps<'div'>, 'children'> {
  value: Record<string, Array<T>>
  onValueChange: (value: Record<string, Array<T>>) => void
  getItemValue: (item: T) => string
  children: ReactNode
  onMove?: (event: KanbanMoveEvent) => void
  onDragEnd?: () => void
  modifiers?: Modifiers
  disabled?: boolean
}

/**
 * Custom collision detection: try pointerWithin first (works when pointer
 * is inside a droppable), fall back to closestCenter (handles cases where
 * the pointer is between columns or above shorter columns).
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  const firstPointer = getFirstCollision(pointerCollisions, 'id')
  if (firstPointer) return pointerCollisions
  return closestCenter(args)
}

/**
 * Helper: find which column contains a given item id.
 * Pure function — no hooks, no closures over state.
 */
function findContainerInColumns<T>(
  id: UniqueIdentifier,
  cols: Record<string, Array<T>>,
  columnIds: Array<string>,
  getItemValue: (item: T) => string
): string | undefined {
  if (columnIds.includes(id as string)) return id as string
  return columnIds.find((key) => cols[key].some((item) => getItemValue(item) === id))
}

function Kanban<T>({
  value,
  onValueChange,
  getItemValue,
  children,
  className,
  render,
  onMove,
  onDragEnd: onDragEndProp,
  modifiers,
  disabled = false,
  ...props
}: KanbanRootProps<T>) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null)

  // Refs sync to avoid stale closures in drag handlers without listing
  // them in dependency arrays (which would re-create the handlers on every
  // value change and break drag state).
  const columnsRef = useRef(value)
  columnsRef.current = value

  const onValueChangeRef = useRef(onValueChange)
  onValueChangeRef.current = onValueChange

  const getItemValueRef = useRef(getItemValue)
  getItemValueRef.current = getItemValue

  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const onDragEndPropRef = useRef(onDragEndProp)
  onDragEndPropRef.current = onDragEndProp

  // Snapshot at drag start for cancel recovery
  const columnsAtDragStart = useRef<Record<string, Array<T>>>(value)

  // Conditionally enable sensors based on disabled prop
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 10 }
    }),
    // Touch: press-and-hold to start a drag so a quick swipe still scrolls
    // the board/column instead of fighting it.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  const columnIds = useMemo(() => Object.keys(value), [value])
  const columnIdsRef = useRef(columnIds)
  columnIdsRef.current = columnIds

  const isColumn = useCallback(
    (id: UniqueIdentifier) => columnIdsRef.current.includes(id as string),
    []
  )

  const findContainer = useCallback(
    (id: UniqueIdentifier) =>
      findContainerInColumns(id, columnsRef.current, columnIdsRef.current, getItemValueRef.current),
    []
  )

  // ── Stable drag handlers (no columns/columnIds deps) ───────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    columnsAtDragStart.current = columnsRef.current
    setActiveId(event.active.id)
  }, [])

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (onMoveRef.current) return

      const { active, over } = event
      if (!over) return
      if (isColumn(active.id)) return

      const columns = columnsRef.current
      const activeContainer = findContainer(active.id)
      const overContainer = findContainer(over.id)

      if (!activeContainer || !overContainer) return
      if (activeContainer === overContainer) return

      const activeItems = columns[activeContainer]
      const overItems = columns[overContainer]

      const activeIndex = activeItems.findIndex(
        (item: T) => getItemValueRef.current(item) === active.id
      )
      let overIndex = overItems.findIndex((item: T) => getItemValueRef.current(item) === over.id)

      if (isColumn(over.id)) {
        overIndex = overItems.length
      } else {
        // dnd-kit's `over.id` is whichever card the pointer is over. If we're
        // hovering past the vertical midline of that card, drop AFTER it
        // (overIndex + 1); otherwise drop BEFORE. Without this modifier,
        // dropping anywhere on a card always inserts above it — which is why
        // placement felt off (e.g. dropping in the 4th slot ended up in the
        // 3rd, etc.).
        const translatedRect = active.rect.current.translated
        if (translatedRect) {
          const overRect = over.rect
          const draggedCenter = translatedRect.top + translatedRect.height / 2
          const overMid = overRect.top + overRect.height / 2
          if (draggedCenter > overMid) {
            overIndex = overIndex + 1
          }
        }
      }

      const newActiveItems = [...activeItems]
      const newOverItems = [...overItems]
      const [movedItem] = newActiveItems.splice(activeIndex, 1)
      newOverItems.splice(overIndex, 0, movedItem)

      onValueChangeRef.current({
        ...columns,
        [activeContainer]: newActiveItems,
        [overContainer]: newOverItems
      })
    },
    [findContainer, isColumn]
  )

  const handleDragCancel = useCallback(() => {
    onValueChangeRef.current(columnsAtDragStart.current)
    setActiveId(null)
    onDragEndPropRef.current?.()
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)

      if (!over) {
        onDragEndPropRef.current?.()
        return
      }

      const columns = columnsRef.current
      const colIds = columnIdsRef.current
      const getVal = getItemValueRef.current

      // Handle item move callback
      if (onMoveRef.current && !isColumn(active.id)) {
        const activeContainer = findContainer(active.id)
        const overContainer = findContainer(over.id)

        if (activeContainer && overContainer) {
          const activeIndex = columns[activeContainer].findIndex(
            (item: T) => getVal(item) === active.id
          )
          const overIndex = isColumn(over.id)
            ? columns[overContainer].length
            : columns[overContainer].findIndex((item: T) => getVal(item) === over.id)

          onMoveRef.current({
            event,
            activeContainer,
            activeIndex,
            overContainer,
            overIndex
          })
        }
        onDragEndPropRef.current?.()
        return
      }

      // Handle column reordering
      if (isColumn(active.id) && isColumn(over.id)) {
        const activeIndex = colIds.indexOf(active.id as string)
        const overIndex = colIds.indexOf(over.id as string)
        if (activeIndex !== overIndex) {
          const newOrder = arrayMove(colIds, activeIndex, overIndex)
          const newColumns: Record<string, Array<T>> = {}
          newOrder.forEach((key) => {
            newColumns[key] = columns[key]
          })
          onValueChangeRef.current(newColumns)
        }
        onDragEndPropRef.current?.()
        return
      }

      // Handle item reordering within same column
      const activeContainer = findContainer(active.id)
      const overContainer = findContainer(over.id)

      if (activeContainer && overContainer && activeContainer === overContainer) {
        const container = activeContainer
        const activeIndex = columns[container].findIndex((item: T) => getVal(item) === active.id)
        const overIndex = columns[container].findIndex((item: T) => getVal(item) === over.id)

        if (activeIndex !== overIndex) {
          onValueChangeRef.current({
            ...columns,
            [container]: arrayMove(columns[container], activeIndex, overIndex)
          })
        }
      }

      onDragEndPropRef.current?.()
    },
    [findContainer, isColumn]
  )

  const contextValue = useMemo(
    () => ({
      columns: value,
      setColumns: onValueChange,
      getItemId: getItemValue,
      columnIds,
      activeId,
      setActiveId,
      findContainer,
      isColumn,
      modifiers
    }),
    [value, onValueChange, getItemValue, columnIds, activeId, findContainer, isColumn, modifiers]
  )

  const defaultProps = {
    'data-slot': 'kanban',
    'data-dragging': activeId !== null,
    className: cn(activeId !== null && 'cursor-grabbing!', className),
    children
  }

  return (
    <KanbanContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={kanbanCollisionDetection}
        modifiers={modifiers}
        onDragStart={disabled ? undefined : handleDragStart}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragEnd={disabled ? undefined : handleDragEnd}
        onDragCancel={disabled ? undefined : handleDragCancel}
      >
        {useRender({
          defaultTagName: 'div',
          render,
          props: mergeProps<'div'>(defaultProps, props)
        })}
      </DndContext>
    </KanbanContext.Provider>
  )
}

export type KanbanBoardProps = useRender.ComponentProps<'div'>

function KanbanBoard({ className, render, ...props }: KanbanBoardProps) {
  const { columnIds } = useContext(KanbanContext)

  const defaultProps = {
    'data-slot': 'kanban-board',
    className: cn('flex gap-4', className),
    children: props.children
  }

  return (
    <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </SortableContext>
  )
}

export interface KanbanColumnProps extends useRender.ComponentProps<'div'> {
  value: string
  disabled?: boolean
}

function KanbanColumn(props: KanbanColumnProps) {
  const isOverlay = useContext(IsOverlayContext)
  if (isOverlay) return <KanbanColumnOverlay {...props} />
  return <KanbanColumnSortable {...props} />
}

function KanbanColumnOverlay({ value, className, render, ...props }: KanbanColumnProps) {
  const defaultProps = {
    'data-slot': 'kanban-column',
    'data-value': value,
    'data-dragging': true,
    className: cn('group/kanban-column flex flex-col', className),
    children: props.children
  }

  return (
    <ColumnContext.Provider
      value={{
        attributes: {} as DraggableAttributes,
        listeners: undefined,
        isDragging: true,
        disabled: false
      }}
    >
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </ColumnContext.Provider>
  )
}

function KanbanColumnSortable({ value, className, render, disabled, ...props }: KanbanColumnProps) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging: isSortableDragging
  } = useSortable({
    id: value,
    disabled,
    animateLayoutChanges
  })

  const { activeId, isColumn } = useContext(KanbanContext)
  const isColumnDragging = activeId ? isColumn(activeId) : false

  const style = {
    transition,
    transform: CSS.Transform.toString(transform)
  } as CSSProperties

  const defaultProps = {
    'data-slot': 'kanban-column',
    'data-value': value,
    'data-dragging': isSortableDragging,
    'data-disabled': disabled,
    ref: setNodeRef,
    style,
    className: cn(
      'group/kanban-column flex flex-col',
      isSortableDragging && 'z-50 opacity-50',
      className
    ),
    children: props.children
  }

  return (
    <ColumnContext.Provider
      value={{ attributes, listeners, isDragging: isColumnDragging, disabled }}
    >
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </ColumnContext.Provider>
  )
}

export interface KanbanColumnHandleProps extends useRender.ComponentProps<'div'> {
  cursor?: boolean
}

function KanbanColumnHandle({
  className,
  render,
  cursor = true,
  ...props
}: KanbanColumnHandleProps) {
  const { attributes, listeners, isDragging, disabled } = useContext(ColumnContext)

  const defaultProps = {
    'data-slot': 'kanban-column-handle',
    'data-dragging': isDragging,
    'data-disabled': disabled,
    ...attributes,
    ...listeners,
    className: cn(
      'opacity-0 transition-opacity group-hover/kanban-column:opacity-100 pointer-coarse:opacity-100',
      cursor && (isDragging ? 'cursor-grabbing!' : 'cursor-grab!'),
      className
    ),
    children: props.children
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props)
  })
}

export interface KanbanItemProps extends useRender.ComponentProps<'div'> {
  value: string
  disabled?: boolean
}

function KanbanItem(props: KanbanItemProps) {
  const isOverlay = useContext(IsOverlayContext)
  if (isOverlay) return <KanbanItemOverlay {...props} />
  return <KanbanItemSortable {...props} />
}

function KanbanItemOverlay({ value, className, render, ...props }: KanbanItemProps) {
  const defaultProps = {
    'data-slot': 'kanban-item',
    'data-value': value,
    'data-dragging': true,
    className: cn(className),
    children: props.children
  }

  return (
    <ItemContext.Provider value={{ listeners: undefined, isDragging: true, disabled: false }}>
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </ItemContext.Provider>
  )
}

function KanbanItemSortable({ value, className, render, disabled, ...props }: KanbanItemProps) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging: isSortableDragging
  } = useSortable({
    id: value,
    disabled,
    animateLayoutChanges
  })

  const { activeId, isColumn } = useContext(KanbanContext)
  const isItemDragging = activeId ? !isColumn(activeId) : false

  const style = {
    transition,
    transform: CSS.Transform.toString(transform)
  } as CSSProperties

  const defaultProps = {
    'data-slot': 'kanban-item',
    'data-value': value,
    'data-dragging': isSortableDragging,
    'data-disabled': disabled,
    ref: setNodeRef,
    style,
    ...attributes,
    className: cn(isSortableDragging && 'z-50 opacity-50', className),
    children: props.children
  }

  return (
    <ItemContext.Provider value={{ listeners, isDragging: isItemDragging, disabled }}>
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </ItemContext.Provider>
  )
}

export interface KanbanItemHandleProps extends useRender.ComponentProps<'div'> {
  cursor?: boolean
}

function KanbanItemHandle({ className, render, cursor = true, ...props }: KanbanItemHandleProps) {
  const { listeners, isDragging, disabled } = useContext(ItemContext)

  const defaultProps = {
    'data-slot': 'kanban-item-handle',
    'data-dragging': isDragging,
    'data-disabled': disabled,
    ...listeners,
    className: cn(cursor && (isDragging ? 'cursor-grabbing!' : 'cursor-grab!'), className),
    children: props.children
  }

  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(defaultProps, props)
  })
}

export interface KanbanColumnContentProps extends useRender.ComponentProps<'div'> {
  value: string
}

function KanbanColumnContent({ value, className, render, ...props }: KanbanColumnContentProps) {
  const { columns, getItemId } = useContext(KanbanContext)

  const items = columns[value]
  const itemIds = useMemo(() => items.map(getItemId), [items, getItemId])

  const defaultProps = {
    'data-slot': 'kanban-column-content',
    className: cn('flex flex-col gap-2', className),
    children: props.children
  }

  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      {useRender({
        defaultTagName: 'div',
        render,
        props: mergeProps<'div'>(defaultProps, props)
      })}
    </SortableContext>
  )
}

export interface KanbanOverlayProps extends Omit<
  React.ComponentProps<typeof DragOverlay>,
  'children'
> {
  children?:
    ReactNode | ((params: { value: UniqueIdentifier; variant: 'column' | 'item' }) => ReactNode)
}

function KanbanOverlay({ children, className, ...props }: KanbanOverlayProps) {
  const { activeId, isColumn, modifiers } = useContext(KanbanContext)
  const [mounted, setMounted] = useState(false)

  useLayoutEffect(() => setMounted(true), [])

  const variant = activeId ? (isColumn(activeId) ? 'column' : 'item') : 'item'

  const content =
    activeId && children
      ? typeof children === 'function'
        ? children({ value: activeId, variant })
        : children
      : null

  if (!mounted) return null

  return createPortal(
    <DragOverlay
      dropAnimation={dropAnimationConfig}
      modifiers={modifiers}
      className={cn('z-50', activeId && 'cursor-grabbing', className)}
      {...props}
    >
      <IsOverlayContext.Provider value={true}>{content}</IsOverlayContext.Provider>
    </DragOverlay>,
    document.body
  )
}

export {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnHandle,
  KanbanItem,
  KanbanItemHandle,
  KanbanColumnContent,
  KanbanOverlay,
  KanbanContext
}
