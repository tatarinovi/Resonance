import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RequireAdmin } from "@/components/RequireAdmin";
import { ShellLayoutGate } from "@/components/layout/ShellLayoutGate";
import { AdminDashboardPersonaProvider } from "@/contexts/AdminDashboardPersonaContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { DataBridge } from "@/contexts/DataBridge";
import { ThemePreferenceProvider } from "@/contexts/ThemeContext";

import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import RegisterPage from "@/pages/RegisterPage";

const ActivityPage = lazy(() => import("@/pages/ActivityPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const EpicDetailPage = lazy(() => import("@/pages/EpicDetailPage"));
const EpicsPage = lazy(() => import("@/pages/EpicsPage"));
const ReleasesPage = lazy(() => import("@/pages/ReleasesPage"));
const ReleaseDetailPage = lazy(() => import("@/pages/ReleaseDetailPage"));
const AdminFeedbackPage = lazy(() => import("@/pages/AdminFeedbackPage"));
const FeedbackPage = lazy(() => import("@/pages/FeedbackPage"));
const InboxPage = lazy(() => import("@/pages/InboxPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetailPage"));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage"));
const QuestionDetailPage = lazy(() => import("@/pages/QuestionDetailPage"));
const QuestionsPage = lazy(() => import("@/pages/QuestionsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const StatisticsPage = lazy(() => import("@/pages/StatisticsPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const UserProfilePage = lazy(() => import("@/pages/UserProfilePage"));
const KanbanProjectBoardPage = lazy(() => import("@/pages/KanbanProjectBoardPage"));
const KanbanProjectMemberRolesPage = lazy(() => import("@/pages/KanbanProjectMemberRolesPage"));
const KanbanProjectsPage = lazy(() => import("@/pages/KanbanProjectsPage"));
const KanbanTeamRolesHubPage = lazy(() => import("@/pages/KanbanTeamRolesHubPage"));
const KanbanAnalyticsEpicsPage = lazy(() => import("@/pages/KanbanAnalyticsEpicsPage"));
const KanbanAnalyticsEpicDetailPage = lazy(() => import("@/pages/KanbanAnalyticsEpicDetailPage"));
const KanbanAnalyticsTasksPage = lazy(() => import("@/pages/KanbanAnalyticsTasksPage"));
const KanbanAnalyticsWorkloadPage = lazy(() => import("@/pages/KanbanAnalyticsWorkloadPage"));
const KanbanSummaryPage = lazy(() => import("@/pages/KanbanSummaryPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ShellRoute({ children }: { children: React.ReactNode }) {
  return (
    <AdminDashboardPersonaProvider>
      <DataBridge>
        <ShellLayoutGate>
          <Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Загрузка страницы…</div>}>
            {children}
          </Suspense>
        </ShellLayoutGate>
      </DataBridge>
    </AdminDashboardPersonaProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemePreferenceProvider>
        <TooltipProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />

              <Route path="/" element={<ShellRoute><DashboardPage /></ShellRoute>} />
              <Route path="/inbox" element={<ShellRoute><InboxPage /></ShellRoute>} />
              <Route path="/questions" element={<ShellRoute><QuestionsPage /></ShellRoute>} />
              <Route path="/questions/:id" element={<ShellRoute><QuestionDetailPage /></ShellRoute>} />
              <Route path="/epics" element={<ShellRoute><EpicsPage /></ShellRoute>} />
              <Route path="/epics/:id" element={<ShellRoute><EpicDetailPage /></ShellRoute>} />
              <Route path="/releases" element={<ShellRoute><ReleasesPage /></ShellRoute>} />
              <Route path="/releases/:id" element={<ShellRoute><ReleaseDetailPage /></ShellRoute>} />
              <Route path="/activity" element={<ShellRoute><ActivityPage /></ShellRoute>} />
              <Route path="/statistics" element={<ShellRoute><StatisticsPage /></ShellRoute>} />
              <Route path="/users" element={<ShellRoute><RequireAdmin><UsersPage /></RequireAdmin></ShellRoute>} />
              <Route path="/users/:id" element={<ShellRoute><UserProfilePage /></ShellRoute>} />
              <Route
                path="/admin/feedback"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <AdminFeedbackPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/team-roles"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanTeamRolesHubPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/projects/:slug/member-roles"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanProjectMemberRolesPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/projects/:slug"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanProjectBoardPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/projects"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanProjectsPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/analytics/epics"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanAnalyticsEpicsPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/analytics/epics/:epicId"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanAnalyticsEpicDetailPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/analytics/tasks"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanAnalyticsTasksPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/summary"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanSummaryPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route
                path="/admin/kanban/analytics/workload"
                element={
                  <ShellRoute>
                    <RequireAdmin>
                      <KanbanAnalyticsWorkloadPage />
                    </RequireAdmin>
                  </ShellRoute>
                }
              />
              <Route path="/projects" element={<ShellRoute><ProjectsPage /></ShellRoute>} />
              <Route path="/projects/:id" element={<ShellRoute><ProjectDetailPage /></ShellRoute>} />
              <Route path="/settings" element={<ShellRoute><SettingsPage /></ShellRoute>} />
              <Route path="/profile" element={<ShellRoute><ProfilePage /></ShellRoute>} />
              <Route path="/feedback" element={<ShellRoute><FeedbackPage /></ShellRoute>} />

              <Route path="*" element={<NotFound />} />
              <Route path="" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </TooltipProvider>
      </ThemePreferenceProvider>
    </QueryClientProvider>
  );
}
