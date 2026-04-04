import { useEffect, useState } from 'react'

type SessionFile = {
  date: string
  path: string
  filename: string
}

type RoutingEntry = {
  timestamp: string
  queryPreview: string
  chosenTier: string
  reason: string
  confidence: number
  wasOverridden: boolean
  conversationId?: string
  estimatedCost?: number
}

type Tab = 'sessions' | 'routing'

export default function HistoryPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<SessionFile[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionContent, setSessionContent] = useState('')
  const [routingDates, setRoutingDates] = useState<string[]>([])
  const [selectedRoutingDate, setSelectedRoutingDate] = useState<string>('')
  const [routingEntries, setRoutingEntries] = useState<RoutingEntry[]>([])

  useEffect(() => {
    const load = async () => {
      const sessionResult = await window.electron.sessionList?.(50)
      if (sessionResult?.success) setSessions(sessionResult.sessions)

      const routingDateResult = await window.electron.routingGetDates?.()
      if (routingDateResult?.success) {
        setRoutingDates(routingDateResult.dates)
        const firstDate = routingDateResult.dates[0] ?? ''
        setSelectedRoutingDate(firstDate)
        if (firstDate) {
          const routingResult = await window.electron.routingGetEntries?.(firstDate)
          if (routingResult?.success) setRoutingEntries(routingResult.entries)
        }
      }
    }
    load().catch(() => {})
  }, [])

  const openSession = async (filePath: string) => {
    setSelectedSession(filePath)
    const result = await window.electron.sessionRead?.(filePath)
    setSessionContent(result?.content ?? '')
  }

  const loadRoutingDate = async (dateStr: string) => {
    setSelectedRoutingDate(dateStr)
    const result = await window.electron.routingGetEntries?.(dateStr)
    if (result?.success) setRoutingEntries(result.entries)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="arcos-panel-head flex items-center gap-2 border-b border-border px-4 py-2">
        {(['sessions', 'routing'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${activeTab === tab ? 'arcos-tab arcos-tab-active' : 'arcos-tab'}`}
          >
            {tab === 'sessions' ? 'Sessions' : 'Routing Logs'}
          </button>
        ))}
        <button
          onClick={() => window.electron.learningsOpenDir?.()}
          className="arcos-action ml-auto rounded px-2 py-1 text-[10px] uppercase tracking-wider"
        >
          Open Folder
        </button>
      </div>

      {activeTab === 'sessions' ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-56 border-r border-border bg-[#14181d]">
            <div className="p-3">
              <p className="arcos-kicker">Recorded Sessions</p>
            </div>
            <div className="overflow-y-auto">
              {sessions.length === 0 ? (
                <div className="px-3 py-4 text-xs italic text-text-muted">No sessions yet.</div>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.path}
                    onClick={() => openSession(session.path)}
                    className={`w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors ${
                      selectedSession === session.path ? 'bg-[#1f252d] text-text' : 'text-text-muted hover:bg-[#1a2027] hover:text-text'
                    }`}
                  >
                    <p className="text-xs font-medium">{session.date}</p>
                    <p className="mt-0.5 text-[11px] truncate">{session.filename.replace('_session.md', '').slice(11)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#101318] p-4">
            {sessionContent ? (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-text">{sessionContent}</pre>
            ) : (
              <div className="flex h-full items-center justify-center text-xs italic text-text-muted">
                Select a session to inspect.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="arcos-kicker">Date</span>
              <select
                value={selectedRoutingDate}
                onChange={(event) => loadRoutingDate(event.target.value)}
                className="arcos-input rounded-md px-2 py-1 text-xs"
              >
                {routingDates.map((date) => (
                  <option key={date} value={date}>{date}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {routingEntries.length === 0 ? (
              <div className="rounded-xl border border-border bg-[#12161b] px-4 py-6 text-xs text-text-muted">
                No routing entries for the selected date.
              </div>
            ) : (
              routingEntries.map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-text">{entry.chosenTier}</p>
                    <span className="text-[11px] text-text-muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{entry.queryPreview}</p>
                  <p className="mt-2 text-[11px] leading-5 text-text-muted">{entry.reason}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

