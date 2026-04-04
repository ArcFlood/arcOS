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

type Tab = 'sessions' | 'routing' | 'learnings'

type SessionPreview = {
  started?: string
  ended?: string
  duration?: string
  totalCost?: string
  topics?: string[]
}

export default function HistoryPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')
  const [sessions, setSessions] = useState<SessionFile[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionContent, setSessionContent] = useState('')
  const [sessionPreview, setSessionPreview] = useState<SessionPreview | null>(null)
  const [routingDates, setRoutingDates] = useState<string[]>([])
  const [selectedRoutingDate, setSelectedRoutingDate] = useState<string>('')
  const [routingEntries, setRoutingEntries] = useState<RoutingEntry[]>([])
  const [learnings, setLearnings] = useState<SessionFile[]>([])
  const [selectedLearning, setSelectedLearning] = useState<string | null>(null)
  const [learningContent, setLearningContent] = useState('')

  useEffect(() => {
    const load = async () => {
      const sessionResult = await window.electron.sessionList?.(50)
      if (sessionResult?.success) setSessions(sessionResult.sessions)

      const learningsResult = await window.electron.learningsList?.(50)
      if (learningsResult?.success) setLearnings(learningsResult.files)

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
    const content = result?.content ?? ''
    setSessionContent(content)
    setSessionPreview(parseSessionPreview(content))
  }

  const loadRoutingDate = async (dateStr: string) => {
    setSelectedRoutingDate(dateStr)
    const result = await window.electron.routingGetEntries?.(dateStr)
    if (result?.success) setRoutingEntries(result.entries)
  }

  const openLearning = async (filePath: string) => {
    setSelectedLearning(filePath)
    const result = await window.electron.learningsRead?.(filePath)
    setLearningContent(result?.content ?? '')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="arcos-panel-head flex items-center gap-2 border-b border-border px-4 py-2">
        {(['sessions', 'routing', 'learnings'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${activeTab === tab ? 'arcos-tab arcos-tab-active' : 'arcos-tab'}`}
          >
            {tab === 'sessions' ? 'Sessions' : tab === 'routing' ? 'Routing Logs' : 'Learnings'}
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
              <div className="space-y-4">
                {sessionPreview && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <HistoryStat label="Started" value={sessionPreview.started ?? 'Unknown'} />
                    <HistoryStat label="Ended" value={sessionPreview.ended ?? 'Unknown'} />
                    <HistoryStat label="Duration" value={sessionPreview.duration ?? 'Unknown'} />
                    <HistoryStat label="Total Cost" value={sessionPreview.totalCost ?? 'Unknown'} />
                  </div>
                )}
                {sessionPreview?.topics && sessionPreview.topics.length > 0 && (
                  <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
                    <p className="arcos-kicker mb-2">Topics</p>
                    <div className="flex flex-wrap gap-2">
                      {sessionPreview.topics.map((topic) => (
                        <span key={topic} className="rounded-full border border-border px-2 py-1 text-[11px] text-text-muted">
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-text">{sessionContent}</pre>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs italic text-text-muted">
                Select a session to inspect.
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'routing' ? (
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
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text">{entry.chosenTier}</p>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                        {Math.round(entry.confidence * 100)}% confidence
                      </span>
                      {entry.wasOverridden && (
                        <span className="rounded-full border border-amber-700/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                          overridden
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-text-muted">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{entry.queryPreview}</p>
                  <p className="mt-2 text-[11px] leading-5 text-text-muted">{entry.reason}</p>
                  {entry.estimatedCost !== undefined && (
                    <p className="mt-2 text-[11px] uppercase tracking-wider text-text-muted">
                      est. cost: ${entry.estimatedCost.toFixed(4)}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-56 border-r border-border bg-[#14181d]">
            <div className="p-3">
              <p className="arcos-kicker">Saved Learnings</p>
            </div>
            <div className="overflow-y-auto">
              {learnings.length === 0 ? (
                <div className="px-3 py-4 text-xs italic text-text-muted">No learnings saved yet.</div>
              ) : (
                learnings.map((learning) => (
                  <button
                    key={learning.path}
                    onClick={() => openLearning(learning.path)}
                    className={`w-full border-b border-border/60 px-3 py-2.5 text-left transition-colors ${
                      selectedLearning === learning.path ? 'bg-[#1f252d] text-text' : 'text-text-muted hover:bg-[#1a2027] hover:text-text'
                    }`}
                  >
                    <p className="text-xs font-medium">{learning.date}</p>
                    <p className="mt-0.5 truncate text-[11px]">{learning.filename.replace('_learning.md', '').slice(11)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#101318] p-4">
            {learningContent ? (
              <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-text">{learningContent}</pre>
            ) : (
              <div className="flex h-full items-center justify-center text-xs italic text-text-muted">
                Select a saved learning to inspect.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#12161b] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-xs font-medium text-text">{value}</p>
    </div>
  )
}

function parseSessionPreview(content: string): SessionPreview {
  const lines = content.split('\n')
  const preview: SessionPreview = {}
  const topics: string[] = []
  let inTopics = false

  for (const line of lines) {
    if (line.startsWith('**Started:**')) preview.started = line.replace('**Started:**', '').trim()
    else if (line.startsWith('**Ended:**')) preview.ended = line.replace('**Ended:**', '').trim()
    else if (line.startsWith('**Duration:**')) preview.duration = line.replace('**Duration:**', '').trim()
    else if (line.startsWith('**Total cost:**')) preview.totalCost = line.replace('**Total cost:**', '').trim()
    else if (line.trim() === '## Topics') inTopics = true
    else if (line.startsWith('## ') && line.trim() !== '## Topics') inTopics = false
    else if (inTopics) {
      const normalized = line.trim().replace(/^[-*]\s*/, '')
      if (normalized && !normalized.startsWith('_')) topics.push(normalized)
    }
  }

  if (topics.length > 0) preview.topics = topics
  return preview
}
