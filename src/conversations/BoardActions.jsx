import { useId, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'

export function BoardActions({ board, disabled, onRename, onDelete }) {
  const id = useId()
  const trigger = useRef(null)
  const menu = useRef(null)
  const [open, setOpen] = useState(false)
  function toggle(event) {
    const visible = event.newState === 'open'
    setOpen(visible)
    if (!visible) return
    const box = trigger.current.getBoundingClientRect()
    const node = menu.current
    const gap = parseFloat(getComputedStyle(node).getPropertyValue('--spacing-sm'))
    node.style.left = `${Math.max(gap, Math.min(box.right - node.offsetWidth, innerWidth - node.offsetWidth - gap))}px`
    node.style.top = `${Math.max(gap, Math.min(box.bottom + gap, innerHeight - node.offsetHeight - gap))}px`
    node.querySelector('button')?.focus()
  }
  function choose(action) { menu.current.hidePopover(); action(board) }
  function keyboard(event) {
    const buttons = [...menu.current.querySelectorAll('button')]
    const index = buttons.indexOf(document.activeElement)
    const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key]
    if (next !== undefined) { event.preventDefault(); buttons[next].focus() }
  }
  return <>
    <button className="hc-board-more" ref={trigger} type="button" disabled={disabled} aria-label={`管理画板：${board.title}`} aria-haspopup="menu" aria-expanded={open} popoverTarget={id}><MoreHorizontal className="hc-settings-icon" aria-hidden="true" /></button>
    <div className="hc-board-menu" id={id} ref={menu} popover="auto" role="menu" aria-label={`${board.title}的操作`} onToggle={toggle} onKeyDown={keyboard}>
      <button type="button" role="menuitem" onClick={() => choose(onRename)}><Pencil className="hc-settings-icon" aria-hidden="true" />重命名</button>
      <button className="hc-danger" type="button" role="menuitem" onClick={() => choose(onDelete)}><Trash2 className="hc-settings-icon" aria-hidden="true" />删除画板</button>
    </div>
  </>
}
