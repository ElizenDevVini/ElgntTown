import dynamic from 'next/dynamic'
const BrainrotLab = dynamic(() => import('../components/BrainrotLab'), { ssr: false })

export default function Page() {
  return <BrainrotLab />
}
