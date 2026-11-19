import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SwRegister } from '@/components/sw-register'

export const metadata: Metadata = {
  title: { default: 'Служение', template: '%s · Служение' },
  description: 'Платформа за хората, екипите, събитията и процесите на организацията',
  applicationName: 'Служение',
  appleWebApp: { capable: true, title: 'Служение', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
}

const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  )
}
