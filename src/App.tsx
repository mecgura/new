import { MotionConfig } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="w-full min-h-screen">
        <Navbar />
        <Hero />
      </div>
    </MotionConfig>
  )
}

export default App
