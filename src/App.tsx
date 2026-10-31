import { Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useApp } from "./lib/session";
import { I18nProvider, useLang } from "./lib/i18n";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { Forgot, Login, Onboarding, Register, ResetPassword } from "./pages/Auth";
import Today from "./pages/Today";
import History from "./pages/History";
import CalendarPage from "./pages/Calendar";
import OccurrencePage from "./pages/Occurrence";
import Review from "./pages/Review";
import Overview from "./pages/Overview";
import { TaskForm, TaskList } from "./pages/Tasks";
import People from "./pages/People";
import Billing from "./pages/Billing";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Schedule from "./pages/Schedule";
import Hours from "./pages/Hours";
import Reports from "./pages/Reports";
import { PlaceList, PlaceView, ScanPage } from "./pages/Places";

function Routed() {
  const { loading, session, me, isManager, isOwner, perm } = useApp();
  if (loading) return <Spinner />;

  if (!session)
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );

  if (!me)
    return (
      <Routes>
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Onboarding />} />
      </Routes>
    );

  // страниците на изключени модули / недопустими за служителя се скриват и от адреса
  return (
    <Routes>
      <Route path="/reset" element={<ResetPassword />} />
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="o/:id" element={<OccurrencePage />} />
        <Route path="profile" element={<Profile />} />
        {perm.qr && <Route path="p/:code" element={<PlaceView />} />}
        {perm.qr && <Route path="scan" element={<ScanPage />} />}
        {perm.calendar && <Route path="calendar" element={<CalendarPage />} />}
        {perm.schedule !== "none" && <Route path="schedule" element={<Schedule />} />}
        {perm.hours && <Route path="hours" element={<Hours />} />}
        {isManager ? (
          <>
            <Route path="review" element={<Review />} />
            <Route path="overview" element={<Overview />} />
            <Route path="tasks" element={<TaskList />} />
            <Route path="tasks/:id" element={<TaskForm />} />
            <Route path="people" element={<People />} />
            <Route path="settings" element={<Settings />} />
            {perm.qr && <Route path="places" element={<PlaceList />} />}
            {perm.reports && <Route path="reports" element={<Reports />} />}
          </>
        ) : (
          perm.history && <Route path="history" element={<History />} />
        )}
        {isOwner && <Route path="billing" element={<Billing />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** При смяна на езика целият интерфейс се изгражда наново, за да приеме новите текстове. */
function Keyed() {
  const { lang } = useLang();
  return <Routed key={lang} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <Keyed />
      </AppProvider>
    </I18nProvider>
  );
}
