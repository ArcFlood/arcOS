import { useEffect } from 'react'
import Layout from './components/Layout'
import DetachedPanelWindow from './components/workspace/DetachedPanelWindow'
import { useSettingsStore } from './stores/settingsStore'
import { WorkspacePanelId } from './workspace/types'

export default function App() {
  const detachedPanel = new URLSearchParams(window.location.search).get('detachedPanel') as WorkspacePanelId | null
  const detachedModule = new URLSearchParams(window.location.search).get('detachedModule')
  const {
    appearanceTheme,
    appearanceFont,
    appearanceTextColor,
    appearanceAccentColor,
    appearanceAccentSecondaryColor,
  } = useSettingsStore((s) => s.settings)

  useEffect(() => {
    document.documentElement.dataset.theme = appearanceTheme
    document.documentElement.style.setProperty('--arcos-font-sans', `'${appearanceFont}', 'IBM Plex Sans', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif`)
    document.documentElement.style.setProperty('--arcos-text', appearanceTextColor)
    document.documentElement.style.setProperty('--arcos-accent', appearanceAccentColor)
    document.documentElement.style.setProperty('--arcos-accent-strong', appearanceAccentColor)
    document.documentElement.style.setProperty('--arcos-warning', appearanceAccentSecondaryColor)
  }, [appearanceTheme, appearanceFont, appearanceTextColor, appearanceAccentColor, appearanceAccentSecondaryColor])

  if (detachedPanel && detachedModule) {
    return <DetachedPanelWindow panelId={detachedPanel} moduleId={detachedModule} />
  }

  return <Layout />
}
