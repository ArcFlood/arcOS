import { useEffect } from 'react'
import ServiceCard from '../services/ServiceCard'
import { useServiceStore } from '../../stores/serviceStore'

export default function ServicePanel() {
  const services = useServiceStore((s) => s.services)
  const checkAllServices = useServiceStore((s) => s.checkAllServices)

  useEffect(() => {
    checkAllServices().catch(() => {})
  }, [checkAllServices])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="arcos-kicker mb-1">Runtime Control</p>
          <p className="text-sm font-semibold text-text">Services</p>
          <p className="text-xs text-text-muted">Runtime health and controls for active PAI services.</p>
        </div>
        <button
          onClick={() => checkAllServices()}
          className="arcos-action rounded-md px-2.5 py-1.5 text-xs transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-3">
        {services.map((service) => (
          <ServiceCard key={service.name} service={service} />
        ))}
      </div>
    </div>
  )
}
