import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider, useSession } from './lib/session'
import { ToastProvider, Loading } from './components/ui'
import AppShell from './components/AppShell'
import Landing from './pages/site/Landing'
import { Login, Signup, AcceptInvite } from './pages/site/Auth'
import { Terms, Privacy } from './pages/site/Legal'
import Docs from './pages/site/Docs'

const Dashboard = lazy(() => import('./pages/app/Dashboard'))
const Inbox = lazy(() => import('./pages/app/Inbox'))
const Contacts = lazy(() => import('./pages/app/Contacts'))
const Pipeline = lazy(() => import('./pages/app/Pipeline'))
const Campaigns = lazy(() => import('./pages/app/Campaigns'))
const CampaignDetail = lazy(() => import('./pages/app/CampaignDetail'))
const Templates = lazy(() => import('./pages/app/Templates'))
const Chatbot = lazy(() => import('./pages/app/Chatbot'))
const Flows = lazy(() => import('./pages/app/Flows'))
const FlowBuilder = lazy(() => import('./pages/app/FlowBuilder'))
const FollowUps = lazy(() => import('./pages/app/FollowUps'))
const AIAssistant = lazy(() => import('./pages/app/AIAssistant'))
const Commerce = lazy(() => import('./pages/app/Commerce'))
const Analytics = lazy(() => import('./pages/app/Analytics'))
const Numbers = lazy(() => import('./pages/app/Numbers'))
const Team = lazy(() => import('./pages/app/Team'))
const Developers = lazy(() => import('./pages/app/Developers'))
const Billing = lazy(() => import('./pages/app/Billing'))
const Settings = lazy(() => import('./pages/app/Settings'))
const Admin = lazy(() => import('./pages/admin/Admin'))

function Protected({ children }: { children: ReactNode }) {
  const { user, loading, ws } = useSession()
  const loc = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (!ws) return <Navigate to="/login" replace />
  return <>{children}</>
}

const app = (el: ReactNode) => <Protected><AppShell><Suspense fallback={<Loading />}>{el}</Suspense></AppShell></Protected>

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/app" element={app(<Dashboard />)} />
            <Route path="/app/inbox" element={app(<Inbox />)} />
            <Route path="/app/contacts" element={app(<Contacts />)} />
            <Route path="/app/pipeline" element={app(<Pipeline />)} />
            <Route path="/app/campaigns" element={app(<Campaigns />)} />
            <Route path="/app/campaigns/:id" element={app(<CampaignDetail />)} />
            <Route path="/app/templates" element={app(<Templates />)} />
            <Route path="/app/chatbot" element={app(<Chatbot />)} />
            <Route path="/app/flows" element={app(<Flows />)} />
            <Route path="/app/flows/:id" element={app(<FlowBuilder />)} />
            <Route path="/app/follow-ups" element={app(<FollowUps />)} />
            <Route path="/app/ai" element={app(<AIAssistant />)} />
            <Route path="/app/commerce" element={app(<Commerce />)} />
            <Route path="/app/analytics" element={app(<Analytics />)} />
            <Route path="/app/numbers" element={app(<Numbers />)} />
            <Route path="/app/team" element={app(<Team />)} />
            <Route path="/app/developers" element={app(<Developers />)} />
            <Route path="/app/billing" element={app(<Billing />)} />
            <Route path="/app/settings" element={app(<Settings />)} />
            <Route path="/admin" element={<Protected><Suspense fallback={<Loading />}><Admin /></Suspense></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  )
}
