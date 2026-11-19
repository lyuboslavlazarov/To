'use client'
import { useEffect } from 'react'
export function PrintButton({ auto }: { auto: boolean }) {
  useEffect(() => { if (auto) setTimeout(() => window.print(), 300) }, [auto])
  return <button className="btn-primary" onClick={() => window.print()}>🖨 Печат</button>
}
