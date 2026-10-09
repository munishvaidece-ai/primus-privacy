import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';

const Overview = lazy(() => import('./pages/Overview'));
const Assessments = lazy(() => import('./pages/Assessments'));
const Wizard = lazy(() => import('./pages/Wizard'));
const Questionnaire = lazy(() => import('./pages/Questionnaire'));
const Review = lazy(() => import('./pages/Review'));
const Evidence = lazy(() => import('./pages/Evidence'));
const Maturity = lazy(() => import('./pages/Maturity'));
const Risk = lazy(() => import('./pages/Risk'));
const Value = lazy(() => import('./pages/Value'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const Benchmarking = lazy(() => import('./pages/Benchmarking'));
const Reports = lazy(() => import('./pages/Reports'));
const PrintReport = lazy(() => import('./pages/PrintReport'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const Loading = () => <div className="py-20 text-center text-sm text-muted" role="status">Loading…</div>;

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="assessments" element={<Assessments />} />
          <Route path="assessments/new" element={<Wizard />} />
          <Route path="questionnaire" element={<Questionnaire />} />
          <Route path="questionnaire/review" element={<Review />} />
          <Route path="evidence" element={<Evidence />} />
          <Route path="maturity" element={<Maturity />} />
          <Route path="risk" element={<Risk />} />
          <Route path="value" element={<Value />} />
          <Route path="roadmap" element={<Roadmap />} />
          <Route path="benchmarking" element={<Benchmarking />} />
          <Route path="reports" element={<Reports />} />
          <Route path="reports/print" element={<PrintReport />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
