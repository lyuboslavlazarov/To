'use client'
import { QrScanner } from '@/components/qr-scanner'
import { scanCode } from '../../actions'

export function ScanClient({ id }: { id: string }) {
  return <QrScanner onScan={(code) => scanCode(code, id)} />
}
