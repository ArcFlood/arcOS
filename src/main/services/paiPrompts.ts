import fs from 'fs'
import os from 'os'
import path from 'path'

export function loadArcPrompts(): { success: true; content: string; source: string } | { success: false; error: string } {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'Documents', 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return { success: true, content: fs.readFileSync(p, 'utf8'), source: p } }
      catch { continue }
    }
  }
  return { success: false, error: 'A.R.C. prompts not found' }
}
