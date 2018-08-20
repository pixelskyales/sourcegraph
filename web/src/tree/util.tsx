export function scrollIntoView(el: Element, scrollRoot: Element): void {
    if (!scrollRoot.getBoundingClientRect) {
        return el.scrollIntoView()
    }

    const rootRect = scrollRoot.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()

    const elAbove = elRect.top <= rootRect.top + 30
    const elBelow = elRect.bottom >= rootRect.bottom

    if (elAbove) {
        el.scrollIntoView(true)
    } else if (elBelow) {
        el.scrollIntoView(false)
    }
}

export const getDomElement = (path: string): Element | null => document.querySelector(`[data-tree-path='${path}']`)