import dynamic from 'next/dynamic'

// Client component (animations, intervals)
const GargleExperiment = dynamic(() => import('../components/GargleExperiment'), { ssr: false })

export default function Page() {
  return <GargleExperiment />
}
