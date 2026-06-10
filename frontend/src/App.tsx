import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RequireAdmin } from "@/components/RequireAdmin";
import { ShellLayoutGate } from "@/components/layout/ShellLayoutGate";
import { AdminDashboardPersonaProvider } from "@/contexts/AdminDashboardPersonaContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { DataBridge } from "@/contexts/DataBridge";

import ActivityPage from "@/pages/ActivityPage";
import DashboardPage from "@/pages/DashboardPage";
import EpicDetailPage from "@/pages/EpicDetailPage";
import EpicsPage from "@/pages/EpicsPage";
import AdminFeedbackPage from "@/pages/AdminFeedbackPage";
import FeedbackPage from "@/pages/FeedbackPage";
import InboxPage from "@/pages/InboxPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import ProfilePage from "@/pages/ProfilePage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import ProjectsPage from "@/pages/ProjectsPage";
import QuestionDetailPage from "@/pages/QuestionDetailPage";
import QuestionsPage from "@/pages/QuestionsPage";
import RegisterPage from "@/pages/RegisterPage";
import SettingsPage from "@/pages/SettingsPage";
import StatisticsPage from "@/pages/StatisticsPage";
import UsersPage from "@/pages/UsersPage";
import UserProfilePage from "@/pages/UserProfilePage";
import KanbanProjectBoardPage from "@/pages/KanbanProjectBoardPage";
import KanbanProjectMemberRolesPage from "@/pages/KanbanProjectMemberRolesPage";
import KanbanProjectsPage from "@/pages/KanbanProjectsPage";
import KanbanTeamRolesHubPage from "@/pages/KanbanTeamRolesHubPage";
import KanbanAnalyticsEpicsPage from "@/pages/KanbanAnalyticsEpicsPage";
import KanbanAnalyticsEpicDetailPage from "@/pages/KanbanAnalyticsEpicDetailPage";
import KanbanAnalyticsTasksPage from "@/pages/KanbanAnalyticsTasksPage";
import KanbanAnalyticsWorkloadPage from "@/pages/KanbanAnalyticsWorkloadPage";
import KanbanSummaryPage from "@/pages/KanbanSummaryPage";

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
        <ShellLayoutGate>{children}</ShellLayoutGate>
      </DataBridge>
    </AdminDashboardPersonaProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
