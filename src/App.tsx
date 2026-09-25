import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Room from './pages/Room'
import GestureLab from './lab/GestureLab'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:id" element={<Room />} />
      <Route path="/lab" element={<GestureLab />} />
    </Routes>
  )
}
