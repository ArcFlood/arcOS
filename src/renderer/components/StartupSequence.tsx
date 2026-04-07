import { useEffect, useRef, useState } from 'react'

const ARCOS_ICON_URL = new URL('../../../build/icon.png', import.meta.url).href
const STARTUP_AUDIO_URL = new URL('../assets/arcos_default_greeting.mp3', import.meta.url).href
const STARTUP_MAX_VISIBLE_MS = 4_000

export default function StartupSequence() {
  const [visible, setVisible] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const dismiss = () => {
    audioRef.current?.pause()
    setVisible(false)
  }

  useEffect(() => {
    let cancelled = false
    const hardTimeout = window.setTimeout(() => {
      window.electron.logAppend?.('warn', 'Startup audio timed out', `Dismissed startup overlay after ${STARTUP_MAX_VISIBLE_MS}ms`)?.catch?.(() => {})
      dismiss()
    }, STARTUP_MAX_VISIBLE_MS)

    const audio = audioRef.current
    if (!audio) {
      window.clearTimeout(hardTimeout)
      dismiss()
      return
    }
    audioRef.current = audio
    audio.onended = dismiss
    audio.onerror = () => {
      if (cancelled) return
      window.electron.logAppend?.('warn', 'Startup audio playback failed', 'The local startup MP3 could not be played.')?.catch?.(() => {})
      dismiss()
    }

    audio.play().catch((error) => {
      if (cancelled) return
      window.electron.logAppend?.('warn', 'Startup audio playback blocked', String(error))?.catch?.(() => {})
      dismiss()
    })

    return () => {
      cancelled = true
      window.clearTimeout(hardTimeout)
    }
  // Startup audio should fire once per renderer session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0b0f14]/82 backdrop-blur-md"
      role="presentation"
      onClick={dismiss}
    >
      <div className="flex flex-col items-center gap-6 rounded-[2rem] border border-white/10 bg-[#121820]/80 px-10 py-9 shadow-2xl">
        <audio ref={audioRef} src={STARTUP_AUDIO_URL} preload="auto" />
        <div className="arcos-startup-orb">
          <img src={ARCOS_ICON_URL} alt="arcOS" className="h-28 w-28 rounded-[1.75rem] object-cover" />
        </div>
        <div className="text-center">
          <p className="arcos-kicker mb-2">arcOS startup</p>
          <h1 className="text-xl font-semibold tracking-[0.18em] text-text">ARCOS</h1>
          <p className="mt-2 max-w-sm text-sm text-text-muted">Workspace ready</p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.18em] text-text-dim">Click to dismiss</p>
        </div>
      </div>
    </div>
  )
}
