import { useCallback, useReducer, useRef } from 'react'

/** A minimal external-store hook: stateRef.current is always the latest value,
 * readable synchronously from anywhere (including async callbacks), and
 * setState triggers a re-render. Same shape as Kotlin's MutableStateFlow —
 * .value for reads, .update {} for writes — used here for the same reason:
 * NavViewModel's logic reads/writes state from async callbacks (location
 * updates, network responses) where React's normal closure-captured state
 * would go stale. */
export function useStore<T>(initialState: T) {
  const [, rerender] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<T>(initialState)

  const setState = useCallback((updater: Partial<T> | ((prev: T) => Partial<T>)) => {
    const patch = typeof updater === 'function' ? (updater as (prev: T) => Partial<T>)(stateRef.current) : updater
    stateRef.current = { ...stateRef.current, ...patch }
    rerender()
  }, [])

  return { stateRef, setState }
}
