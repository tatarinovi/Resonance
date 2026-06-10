import { Clock, Loader2, MessageCircle, Send } from "lucide-react";
import { useParams } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/formatDateTime";
import { mapApiUserToRefUser } from "@/lib/mappers";
import { useUserProfile, useUserProfileStats } from "@/lib/queries";

import { matrixProfileHref, telegramProfileHref, UserProfileView } from "./ProfilePage";

function parseUserId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function ProfilePageState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-3xl flex-col items-center justify-center p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ProfileLoadingState() {
  return (
    <div className="mx-auto flex min-h-[50vh] w-full max-w-3xl flex-col items-center justify-center gap-2 p-6 text-center">
      <Loader2 className="h-7 w-7 animate-spin text-primary/70" aria-hidden />
      <p className="text-sm text-muted-foreground">Загрузка профиля...</p>
    </div>
  );
}

export default function UserProfilePage() {
  const params = useParams();
  const userId = parseUserId(params.id);
  const profile = useUserProfile(userId);
  const stats = useUserProfileStats(userId);

  if (userId == null) {
    return <ProfilePageState title="Пользователь не найден" description="Проверьте ссылку на профиль." />;
  }

  if (profile.isLoading) {
    return <ProfileLoadingState />;
  }

  if (profile.error instanceof ApiError && profile.error.status === 404) {
    return <ProfilePageState title="Пользователь не найден" description="Профиль удалён или недоступен." />;
  }

  if (profile.isError || !profile.data) {
    return <ProfilePageState title="Не удалось загрузить профиль" description="Попробуйте обновить страницу." />;
  }

  const user = mapApiUserToRefUser({
    ...profile.data,
    is_approved: true,
  });

  return (
    <UserProfileView
      user={user}
      stats={stats.data}
      statsLoading={stats.isLoading}
      statsError={stats.isError}
      heading="Профиль пользователя"
      contactItems={[
        {
          label: "Matrix ID",
          value: profile.data.matrix_id || "Не указан",
          href: matrixProfileHref(profile.data.matrix_id),
          icon: <MessageCircle size={12} />,
        },
        {
          label: "Telegram",
          value: profile.data.telegram_id || "Не указан",
          href: telegramProfileHref(profile.data.telegram_id),
          icon: <Send size={12} />,
        },
        {
          label: "Последний вход",
          value: profile.data.last_login_at ? formatDateTime(profile.data.last_login_at) : "Нет данных",
          icon: <Clock size={12} />,
        },
      ]}
    />
  );
}
